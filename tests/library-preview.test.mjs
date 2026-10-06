import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewLibrary, libraryCall } from '../src/library-client.ts';

test('browser asset edits persist across page mounts and do not mutate returned snapshots', async () => {
  const call = createPreviewLibrary();
  const before = await call('state');
  before.prompts.length = 0;
  const id = await call('savePrompt', {
    kind: 'text',
    title: 'Weekly review',
    content: 'Review actual work.',
    tags: ['weekly'],
  });
  await call('favorite', { kind: 'prompt', id });
  await call('savePrompt', {
    id,
    kind: 'text',
    title: 'Updated review',
    content: 'Updated instructions.',
    tags: [],
  });
  const after = await call('state');
  assert.equal(after.prompts.length, 4);
  const saved = after.prompts.find((prompt) => prompt.id === id);
  assert.equal(saved.favorite, true);
  assert.equal(saved.title, 'Updated review');
  assert.equal(saved.content, 'Updated instructions.');
  assert.equal((await createPreviewLibrary()('state')).prompts.length, 3);
});

test('image experiment preserves its original prompt and rating after later edits', async () => {
  const call = createPreviewLibrary();
  const id = await call('savePrompt', {
    kind: 'image',
    title: 'Image',
    content: 'Version 1',
    references: ['blob:reference'],
    generation: { outputs: ['blob:result'], rating: 4, model: 'Demo' },
  });
  await call('savePrompt', { id, kind: 'image', title: 'Image', content: 'Version 2' });
  const record = (await call('state')).prompts.find((prompt) => prompt.id === id);
  assert.equal(record.generations[0].snapshot, 'Version 1');
  assert.equal(record.generations[0].rating, 4);
  assert.equal(record.images.filter((image) => image.role === 'output').length, 1);
  assert.equal(record.images.filter((image) => image.role === 'reference').length, 1);
  assert.equal(record.generations[0].images[0].generation_id, record.generations[0].id);
  await assert.rejects(call('scanLocal'), /桌面版/);
});

test('desktop library requests use the existing vault bridge rather than preview records', async () => {
  const prior = globalThis.window;
  const calls = [];
  globalThis.window = {
    vault: {
      call: async (operation, input) => {
        calls.push([operation, input]);
        return { real: true };
      },
    },
  };
  try {
    assert.deepEqual(await libraryCall('state'), { real: true });
    assert.deepEqual(await libraryCall('saveSkill', { id: 'real-skill' }), { real: true });
    assert.deepEqual(calls, [
      ['state', undefined],
      ['saveSkill', { id: 'real-skill' }],
    ]);
  } finally {
    if (prior === undefined) delete globalThis.window;
    else globalThis.window = prior;
  }
});
