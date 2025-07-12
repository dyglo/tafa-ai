import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
  streamText,
} from 'ai';
import { Buffer } from 'buffer';
import { auth, type UserType } from '@/app/(auth)/auth';
import { type RequestHints, systemPrompt } from '@/lib/ai/prompts';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  getUsageCountByUserId,
  saveUsageLog,
} from '@/lib/db/queries';
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { webSearch } from '@/lib/ai/tools/web-search';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { geolocation } from '@vercel/functions';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';

export const maxDuration = 60;
export const runtime = 'nodejs';

let globalStreamContext: ResumableStreamContext | null = null;

export function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (error.message.includes('REDIS_URL')) {
        console.log(
          ' > Resumable streams are disabled due to missing REDIS_URL',
        );
      } else {
        console.error(error);
      }
    }
  }

  return globalStreamContext;
}

// Helper to download a file and return ArrayBuffer
async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch file');
  return res.arrayBuffer();
}

async function buildModelMessages(uiMessages: ChatMessage[]) {
  const modelMessages: any[] = [];

  for (const msg of uiMessages) {
    if (msg.role !== 'user') {
      modelMessages.push({ role: msg.role, content: msg.parts.filter((p) => p.type === 'text').map((p) => p.text).join('') });
      continue;
    }

    const contentParts: any[] = [];

    for (const part of msg.parts) {
      if (part.type === 'text') {
        contentParts.push({ type: 'text', text: part.text });
      } else if (part.type === 'file') {
        const { url, mediaType } = part;

        if (mediaType.startsWith('image/')) {
          try {
            const arrayBuf = await fetchArrayBuffer(url);
            const base64 = Buffer.from(arrayBuf).toString('base64');
            contentParts.push({
              type: 'image_url',
              image_url: { url: `data:${mediaType};base64,${base64}` },
            });
          } catch (err) {
            console.error('Error processing image attachment', err);
          }
        } else if (mediaType === 'application/pdf') {
          try {
            const arrayBuf = await fetchArrayBuffer(url);

            const extractTextFromPdf = async (buffer: Buffer) => {
              // @ts-ignore - pdf-parse has no type definitions
              const pdfModule = await import('pdf-parse/lib/pdf-parse.js');
              const pdfParse: any = (pdfModule as any).default ?? (pdfModule as any);
              const res = await pdfParse(buffer);
              return res.text || '';
            };

            const text = await extractTextFromPdf(Buffer.from(arrayBuf));
            const textContent = text.substring(0, 12000);
            const summaryPrompt = `Please summarize the following document:\n\n${textContent}`;
            contentParts.push({ type: 'text', text: summaryPrompt });
          } catch (err) {
            console.error('Error processing PDF attachment', err);
          }
        }
      }
    }

    modelMessages.push({ role: 'user', content: contentParts });
  }

  return modelMessages;
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel['id'];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new ChatSDKError('rate_limit:chat').toResponse();
    }

    // Fetch usage count with error handling to avoid breaking the request on DB issues
    let usageCount = 0;
    try {
      usageCount = await getUsageCountByUserId({
        id: session.user.id,
        differenceInHours: 24,
      });
    } catch (err) {
      console.error('Error fetching usage count for rate-limiting', err);
    }

    const dailyLimit = Number(process.env.DAILY_REQUEST_LIMIT ?? '100');

    if (usageCount >= dailyLimit) {
      return new Response(
        JSON.stringify({ message: 'Daily request limit exceeded.' }),
        { status: 429 },
      );
    }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({
        id,
        userId: session.user.id,
        title,
        visibility: selectedVisibilityType,
      });
    } else {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError('forbidden:chat').toResponse();
      }
    }

    const messagesFromDb = await getMessagesByChatId({ id });
    const uiMessages = [...convertToUIMessages(messagesFromDb), message];

    // Preprocess attachments (images, PDFs) into model-compatible message format
    const modelMessagesForAI = await buildModelMessages(uiMessages);

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: 'user',
          parts: message.parts,
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });

    // Holder for token usage metrics we will populate once the model finishes streaming
    const usageData: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    } = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // We’ll keep a reference to the promise returned from `consumeStream()` so that we can
    // await it in `onFinish` (guaranteeing the usage info has been populated).
    let consumePromise: Promise<any> | null = null;

    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system: systemPrompt({ selectedChatModel, requestHints }),
          messages: modelMessagesForAI,
          stopWhen: stepCountIs(5),
          experimental_activeTools:
            selectedChatModel === 'chat-model-reasoning'
              ? []
              : [
                  'getWeather',
                  'updateDocument',
                  'requestSuggestions',
                  'webSearch',
                ],
          experimental_transform: smoothStream({ chunking: 'word' }),
          tools: {
            getWeather,
            createDocument: createDocument({ session, dataStream }),
            updateDocument: updateDocument({ session, dataStream }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
            }),
            webSearch,
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          },
        });

        // Consume the underlying stream. If the helper returns usage data, capture it.
        try {
          consumePromise = result.consumeStream();

          if (consumePromise && typeof consumePromise.then === 'function') {
            consumePromise
              .then((res: any) => {
                const usage = res?.usage;
                if (usage) {
                  usageData.promptTokens =
                    usage.inputTokens ?? usage.promptTokens ?? usage.prompt_tokens ?? 0;
                  usageData.completionTokens =
                    usage.outputTokens ?? usage.completionTokens ?? usage.completion_tokens ?? 0;
                  usageData.totalTokens = usage.totalTokens ?? usage.total_tokens ?? 0;
                }
              })
              .catch((err: unknown) => {
                console.error('Error capturing token usage', err);
              });
          }
        } catch (err) {
          console.error('Error starting stream consumption', err);
        }

        dataStream.merge(
          result.toUIMessageStream({
            sendReasoning: true,
          }),
        );
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        await saveMessages({
          messages: messages.map((message) => ({
            id: message.id,
            role: message.role,
            parts: message.parts,
            createdAt: new Date(),
            attachments: [],
            chatId: id,
          })),
        });

        // Ensure the stream’s consumption (and thus token parsing) is fully completed
        try {
          if (consumePromise) {
            const res: any = await consumePromise;

            // DEBUG: Log the full result object to inspect structure
            try {
              console.log('--- FULL GROK RESULT OBJECT ---', JSON.stringify(res, null, 2));
            } catch (_) {
              console.log('--- FULL GROK RESULT OBJECT (non-serialisable) ---', res);
            }

            // Attempt to extract usage data from various possible paths
            const usage =
              res?.usage ||
              res?.data?.usage ||
              res?.metadata?.usage ||
              null;

            if (usage) {
              usageData.promptTokens =
                usage.inputTokens ?? usage.promptTokens ?? usage.prompt_tokens ?? 0;
              usageData.completionTokens =
                usage.outputTokens ?? usage.completionTokens ?? usage.completion_tokens ?? 0;
              usageData.totalTokens = usage.totalTokens ?? usage.total_tokens ?? 0;
            }
          }
        } catch (err) {
          console.error('Error awaiting consumePromise for usage data', err);
        }

        // DEBUG: Log Grok usage data before persisting to the database
        console.log('--- GROK API USAGE DATA ---', usageData);

        try {
          await saveUsageLog({
            userId: session.user.id,
            model: selectedChatModel,
            requestType: 'chat',
            promptTokens: usageData.promptTokens,
            completionTokens: usageData.completionTokens,
            totalTokens: usageData.totalTokens,
          });
        } catch (err) {
          console.error('Error saving usage log', err);
        }
      },
      onError: () => {
        return 'Oops, an error occurred!';
      },
    });

    const streamContext = getStreamContext();

    if (streamContext) {
      return new Response(
        await streamContext.resumableStream(streamId, () =>
          stream.pipeThrough(new JsonToSseTransformStream()),
        ),
      );
    } else {
      return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
    }
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  const chat = await getChatById({ id });

  if (chat.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
