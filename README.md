# LumiField 官网

`website/` 是无需构建工具的纯静态官网，所有样式、脚本与发布素材均从本目录加载，不使用遥测、Cookie、外部 CDN 或运行时第三方代码。

## 本地预览

不要直接双击 `index.html`；请从仓库根目录启动本地静态服务器：

```powershell
python -m http.server 4173 --directory website
```

然后访问 <http://localhost:4173/>。

## 发布前资源

正式发布前应提供以下文件：

- `assets/screenshots/immersive-stage.png`
- `assets/screenshots/audio-reactive-stage.png`
- `assets/screenshots/music-library.png`
- `assets/screenshots/visual-console.png`
- `assets/screenshots/home.png`
- `assets/screenshots/secondary-stage.png`
- `assets/screenshots/my-panel.png`
- `assets/screenshots/preset-console.png`
- `assets/sponsor/alipay.jpg`
- `assets/sponsor/wechat.png`

图片缺失时页面会显示明确的本地占位状态，不会产生破图或请求外部服务。赞助二维码必须直接复制作者提供的原始文件，禁止重新编码或加工。

安装包下载地址位于 `index.html` 的 `data-download-link` 链接，固定指向正式 `v1.1.43` GitHub Release 的 LumiField 主安装包。更新版本时必须同时核对链接、版本、文件大小、SHA-256、Tag 与 Commit。

## GitHub Pages

可以把本目录内容发布到 `gh-pages` 分支根目录，或配置 GitHub Actions 将 `website/` 作为 Pages artifact。站点不需要 Node.js 构建步骤。

建议部署检查：

1. 使用桌面和移动视口检查导航、标签页、截图轮播、FAQ、SHA 复制和赞助弹窗。
2. 通过正式 Release 下载链接下载文件并复核 SHA-256。
3. 在浏览器网络面板确认没有第三方请求。
4. 检查键盘焦点、`prefers-reduced-motion` 与图片缺失回退状态。
