const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { nativeImage } = require('electron');
function thumbnailService(vault) {
  const pending = new Map();
  // Serialize native decodes so a large gallery does not decode all originals simultaneously.
  let queue = Promise.resolve();
  return async (id) => {
    const original = vault.media(id);
    const stat = fs.statSync(original);
    const folder = path.join(vault.root, 'thumbnails');
    const key = createHash('sha256').update(`${id}-${stat.size}-${stat.mtimeMs}`).digest('hex');
    const target = path.join(folder, `${key}.png`);
    if (fs.existsSync(target)) return target;
    if (!pending.has(target)) {
      const work = queue
        .then(async () => {
          try {
            const image = await nativeImage.createThumbnailFromPath(original, {
              width: 480,
              height: 480,
            });
            if (image.isEmpty()) return original;
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(target, image.toPNG());
            return target;
          } catch {
            return original;
          }
        })
        .finally(() => pending.delete(target));
      pending.set(target, work);
      queue = work.catch(() => {});
    }
    return pending.get(target);
  };
}
module.exports = { thumbnailService };
