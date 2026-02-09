# Ting Reader App

Ting Reader 的 Android 客户端前端项目。本项目基于 `ting-reader-client` 构建，使用 Capacitor 打包为 Android 应用。

**系统要求**: Android 7.0 (Nougat) 及以上版本。

## 功能特性

本项目针对移动端使用场景进行了以下优化和适配：

1.  **移动端登录适配**
    *   支持手动输入自托管服务器地址（如 `http://192.168.1.x:3000`）。
    *   自动处理服务器地址重定向，确保登录流程顺畅。

2.  **离线缓存管理**
    *   内置移动端专用的缓存管理器。
    *   自动管理下载的音频文件，限制最大缓存占用（默认 2GB），自动清理旧文件。

3.  **应用图标与原生体验**
    *   已配置 Android 应用图标。
    *   集成原生媒体控制插件（通知栏播放控制）。

## 开发与构建指南

### 1. 安装依赖

```bash
npm install
```

### 2. 构建与同步

```bash
# 构建前端资源
npm run build

# 同步到 Android 项目
npx cap sync
```

### 3. 运行 Android 应用

```bash
npx cap open android
```
这将打开 Android Studio，您可以连接设备进行调试或打包 APK。

## 目录结构

*   `android/`: Android 原生工程目录。
*   `src/`: 前端源代码。
*   `patches/` & `scripts/`: 自动应用的插件补丁（用于修复部分原生组件问题）。
