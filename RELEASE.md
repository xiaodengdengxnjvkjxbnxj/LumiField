# LumiField v1.1.43 发布流程

## 唯一发布身份

- Tag：`v1.1.43`
- 安装包：`LumiField-1.1.43-Setup.exe`
- 源码包：`LumiField-1.1.43-Source.zip`
- 仓库：<https://github.com/xiaodengdengxnjvkjxbnxj/LumiField>
- 构建依据：Tag 指向的公开、无本机路径和无私密历史的根提交

## 必须上传的 Release 资产

- `LumiField-1.1.43-Setup.exe`
- `LumiField-1.1.43-Source.zip`
- `SHA256SUMS`
- `GPL-3.0.txt`
- `THIRD_PARTY_NOTICES.md`
- `RELEASE_MANIFEST.json`
- `README_RELEASE.md`

`LF-Monitor-Setup.exe`、测试包、旧安装包、`win-unpacked` 和调试产物不得作为主要下载项。

## 发布门

1. 从 Tag 的全新 clone 执行 `npm ci`。
2. `npm audit --omit=dev` 与完整 `npm audit` 均为 0。
3. 后端、UI、Electron 启动和打包完整性 smoke 全部通过。
4. 生产依赖许可证报告无 unknown 和 release blocker。
5. 安装包 ProductVersion、`package.json`、`public/version-manifest.json`、Release Manifest 和网页版本均为 `1.1.43`。
6. 安装包 SHA-256、大小、`app.asar` 身份和源码 Commit 写入 Release Manifest。
7. 实际安装、启动、退出和卸载成功；不安装成后台监控程序。
8. 公开树秘密扫描、本机路径扫描和非授权素材扫描为 0。

详细命令见 [BUILD.md](./BUILD.md)。
