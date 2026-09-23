import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Vault } = require('../electron/store.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-github-'));
const vault = new Vault(root);
try {
  const scan = await vault.scanGithub('https://github.com/openai/skills');
  const candidate = scan.candidates.find((s) => s.name === 'skill-creator') || scan.candidates[0];
  console.log(`Scanned ${scan.candidates.length} skills; selecting ${candidate.name}`);
  const result = vault.importSkills(scan.token, [candidate.key]);
  assert.equal(result.imported, 1);
  const skill = vault.state().skills[0];
  assert.ok(/^[a-f0-9]{40,64}$/.test(skill.commit_hash));
  await vault.checkUpdate(skill.id);
  vault.favorite('skill', skill.id);
  vault.saveSkill({ id: skill.id, name: 'My skill', description: '我的备注', tags: ['保留标签'] });
  vault.db.prepare('UPDATE skills SET commit_hash=? WHERE id=?').run('0'.repeat(40), skill.id);
  assert.equal(await vault.checkUpdate(skill.id), true);
  const commit = await vault.updateSkill(skill.id);
  assert.ok(/^[a-f0-9]{40,64}$/.test(commit));
  const updated = vault.state().skills[0];
  assert.equal(updated.commit_hash, updated.latest_commit);
  assert.deepEqual(updated.tags, ['保留标签']);
  assert.equal(updated.favorite, true);
  assert.equal(updated.name, 'My skill');
  fs.appendFileSync(
    path.join(vault.skill(skill.id).directory, 'SKILL.md'),
    '\nLocal edit that must survive.',
  );
  await assert.rejects(() => vault.updateSkill(skill.id), /外部修改/);
  console.log(
    JSON.stringify(
      {
        passed: true,
        repo: 'https://github.com/openai/skills',
        candidates: scan.candidates.length,
        imported: candidate.name,
        commit,
        checks: [
          'public clone and recursive scan',
          'select and import',
          'detect simulated stale commit',
          'manual update retains metadata',
          'external modification blocks update',
        ],
      },
      null,
      2,
    ),
  );
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(
    'artifacts/github-results.json',
    JSON.stringify(
      {
        passed: true,
        repo: 'https://github.com/openai/skills',
        candidates: scan.candidates.length,
        commit,
      },
      null,
      2,
    ),
  );
} finally {
  vault.close();
  console.log('Isolated GitHub test data:', root);
}
