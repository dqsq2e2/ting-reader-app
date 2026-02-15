const fs = require('fs');
const path = require('path');

console.log('Applying native code patches...');

const patches = [
  {
    src: 'patches/files/cordova-plugin-media/src/android/AudioPlayer.java',
    dest: 'node_modules/cordova-plugin-media/src/android/AudioPlayer.java'
  },
  {
    src: 'patches/files/capacitor-music-controls-plugin/android/src/main/java/com/ingageco/capacitormusiccontrols/CapacitorMusicControls.java',
    dest: 'node_modules/capacitor-music-controls-plugin/android/src/main/java/com/ingageco/capacitormusiccontrols/CapacitorMusicControls.java'
  },
  {
    src: 'patches/files/capacitor-music-controls-plugin/android/src/main/java/com/ingageco/capacitormusiccontrols/MusicControlsNotification.java',
    dest: 'node_modules/capacitor-music-controls-plugin/android/src/main/java/com/ingageco/capacitormusiccontrols/MusicControlsNotification.java'
  },
  {
    src: 'patches/files/capacitor-music-controls-plugin/android/src/main/java/com/ingageco/capacitormusiccontrols/MediaSessionCallback.java',
    dest: 'node_modules/capacitor-music-controls-plugin/android/src/main/java/com/ingageco/capacitormusiccontrols/MediaSessionCallback.java'
  }
];

let successCount = 0;

patches.forEach(patch => {
  const srcPath = path.resolve(__dirname, '..', patch.src);
  const destPath = path.resolve(__dirname, '..', patch.dest);
  
  try {
    if (fs.existsSync(srcPath)) {
      // Ensure destination directory exists (should exist if npm install ran)
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
          console.warn(`Destination directory does not exist: ${destDir}, skipping.`);
          return;
      }

      fs.copyFileSync(srcPath, destPath);
      console.log(`✅ Patched: ${path.basename(patch.dest)}`);
      successCount++;
    } else {
      console.warn(`⚠️  Patch file not found: ${patch.src}`);
    }
  } catch (err) {
    console.error(`❌ Error patching ${patch.dest}:`, err);
  }
});

console.log(`Native patch application complete. (${successCount}/${patches.length} files patched)`);
