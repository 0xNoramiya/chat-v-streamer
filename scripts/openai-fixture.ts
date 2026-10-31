import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
const run = promisify(execFile);
// Local protocol fixture: never described as authenticated OpenAI evidence.
export async function startOpenAIFixture(directory: string) {
  const voice = join(directory, 'fixture-voice.mp3');
  await run('espeak-ng', [
    '-s',
    '190',
    '-w',
    join(directory, 'voice.wav'),
    'The court has receipts. First try guaranteed.',
  ]);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(directory, 'voice.wav'), voice]);
  const audio = await readFile(voice);
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      if (req.url === '/v1/audio/speech') {
        res.setHeader('content-type', 'audio/mpeg');
        res.end(audio);
        return;
      }
      const json = (body: unknown) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      };
      if (req.url === '/v1/models') {
        json({
          data: [
            { id: process.env.OPENAI_MODEL_FAST || 'gpt-5-mini' },
            { id: process.env.OPENAI_MODEL_SMART || 'gpt-5' },
          ],
        });
        return;
      }
      if (req.url === '/v1/audio/transcriptions') {
        json({ text: 'This boss is easy, first try guaranteed.' });
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (req.url === '/v1/moderations') {
        json({
          results: (Array.isArray(body.input) ? body.input : [body.input]).map(() => ({
            flagged: false,
          })),
        });
        return;
      }
      if (req.url !== '/v1/responses') {
        res.writeHead(404).end();
        return;
      }
      const request = z
        .object({ input: z.string(), text: z.object({ format: z.object({ name: z.string() }) }) })
        .parse(body);
      const input = JSON.parse(request.input);
      let result: unknown;
      switch (request.text.format.name) {
        case 'clerk':
          result = {
            admissible: true,
            reason_code: 'ok',
            category: 'gameplay_claim',
            formal_charge: 'The defendant guaranteed a first-try victory and failed to deliver.',
            short_title: 'The First Try Affair',
            search_hints: ['first', 'try', 'boss'],
          };
          break;
        case 'trial_script': {
          const ids = [...String(input.candidates).matchAll(/\[(seg_\d+) \|/g)]
            .map((m) => m[1])
            .slice(0, 3);
          result = {
            has_case: ids.length > 0,
            exhibits: ids.map((segment_id) => ({
              segment_id,
              framing: 'A stored on-stream receipt.',
            })),
            cited_precedent_id: null,
            opening_line: 'Court is open. The first-try guarantee is on trial.',
            exhibit_lines: ids.map(
              (_, i) => `Exhibit ${String.fromCharCode(65 + i)}. The record has receipts.`,
            ),
            defense_prompt: 'You have thirty seconds to defend that guarantee.',
          };
          break;
        }
        case 'rebuttal':
          result = {
            rebuttal_line: 'The defense blames lag. The guarantee omitted that footnote.',
            new_exhibit: null,
          };
          break;
        case 'verdict': {
          const guilty = input.verdict === 'guilty';
          result = {
            verdict_line: guilty
              ? 'Guilty. The jury has spoken.'
              : input.verdict === 'mistrial'
                ? 'Mistrial. No jury votes.'
                : 'Not guilty. Doubt belongs to the defendant.',
            sentence_id: guilty ? (input.allowed_penal_code[0]?.id ?? null) : null,
            sentence_flavor: guilty ? 'The title shall carry the receipt.' : '',
            title_text: guilty ? '[CONVICTED] The first try guarantee' : null,
            precedent_summary: 'Established: A guarantee must survive the first attempt.',
          };
          break;
        }
        default:
          throw Error('Unknown fixture role');
      }
      json({
        id: 'resp_local_fixture',
        object: 'response',
        status: 'completed',
        output: [
          {
            id: 'msg_local_fixture',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: JSON.stringify(result), annotations: [] }],
          },
        ],
      });
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Fixture unavailable');
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
