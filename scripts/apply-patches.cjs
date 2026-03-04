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
  },
  {
    src: 'patches/files/@capacitor/filesystem/android/src/main/kotlin/com/capacitorjs/plugins/filesystem/FilesystemPlugin.kt',
    dest: 'node_modules/@capacitor/filesystem/android/src/main/kotlin/com/capacitorjs/plugins/filesystem/FilesystemPlugin.kt'
  },
  {
    src: 'patches/files/@capacitor/filesystem/android/src/main/kotlin/com/capacitorjs/plugins/filesystem/LegacyFilesystemImplementation.kt',
    dest: 'node_modules/@capacitor/filesystem/android/src/main/kotlin/com/capacitorjs/plugins/filesystem/LegacyFilesystemImplementation.kt'
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

// Remove flatDir from capacitor-cordova-android-plugins/build.gradle if it exists
const pluginsGradlePath = path.resolve(__dirname, '..', 'android/capacitor-cordova-android-plugins/build.gradle');
if (fs.existsSync(pluginsGradlePath)) {
  try {
    let content = fs.readFileSync(pluginsGradlePath, 'utf8');
    const flatDirPattern = /flatDir\s*\{\s*dirs\s+'src\/main\/libs',\s*'libs'\s*\}/g;
    
    if (flatDirPattern.test(content)) {
      content = content.replace(flatDirPattern, '// flatDir { dirs ... } removed by patch');
      fs.writeFileSync(pluginsGradlePath, content, 'utf8');
      console.log('✅ Removed flatDir from capacitor-cordova-android-plugins/build.gradle');
    } else {
      console.log('ℹ️  flatDir already removed or not found in capacitor-cordova-android-plugins/build.gradle');
    }
  } catch (err) {
    console.error('❌ Error modifying capacitor-cordova-android-plugins/build.gradle:', err);
  }
} else {
    console.warn('⚠️  capacitor-cordova-android-plugins/build.gradle not found (run npx cap sync first)');
}
