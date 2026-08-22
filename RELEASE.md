# LumiField v1.1.44 发布流程

## 唯一发布身份

- Tag：`v1.1.44`
- 安装包：`LumiField-1.1.44-Setup.exe`
- 源码包：`LumiField-1.1.44-Source.zip`
- 仓库：<https://github.com/xiaodengdengxnjvkjxbnxj/LumiField>
- 构建依据：Tag 指向的公开、干净、无本机路径和无私密历史的提交

v1.1.43 已冻结在提交
`f20b09f2ab27dab7cfebe4aa2ffa3e17b8736fab`，本流程不得移动其 Tag、替换其
Release 或重写其任何公开资产。

## 必须上传的 Release 资产

- `LumiField-1.1.44-Setup.exe`
- `LumiField-1.1.44-Source.zip`
- `SHA256SUMS`
- `GPL-3.0.txt`
- `THIRD_PARTY_NOTICES.md`
- `RELEASE_MANIFEST.json`
- `README_RELEASE.md`

`LF-Monitor-Setup.exe`、测试包、旧安装包、`win-unpacked` 和调试产物不得作为
主要下载项。

## 发布门

1. 从候选 Tag 的全新 clone 执行 `npm ci`。
2. `npm audit --omit=dev` 与完整 `npm audit` 均为 0。
3. 后端、UI、Electron、四档 DPI、性能和打包完整性 smoke 全部通过。
4. 生产依赖许可证报告 unknown = 0、release blocker = 0；AGPL 对应源码、
   MIT/MPL/Apache/GPL 许可文本及来源记录均进入正确发行边界。
5. 安装包 ProductVersion、`package.json`、`public/version-manifest.json`、
   Release Manifest 和网页版本均为 `1.1.44`。
6. 安装包、源码包、`app.asar`、可执行文件和源码 Commit 的 SHA-256 写入
   Release Manifest 与 `SHA256SUMS`。
7. 实际安装、启动、退出和卸载成功；主播放器不安装成后台监控程序。
8. 公开树秘密扫描、本机路径扫描、非授权素材扫描及最终公共发行审计为 0。
9. GitHub Release、Tag、全部资产与 GitHub Pages 下载链接上线后再次远程核验。

详细命令见 [BUILD.md](./BUILD.md)。
