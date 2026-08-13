# Security Policy

## Supported Versions

当前只维护最新公开版本。

## Installer Safety Notice

`v1.0.10` 及更早旧安装包不再建议继续安装或传播。需要安装 LumiField 时，请使用官方仓库 `v1.1.43` 或更新版本的 GitHub Release 安装包，并用 `SHA256SUMS` 验证文件。

## Reporting a Vulnerability

如果你发现安全问题，请通过 GitHub Issues 或仓库作者主页联系作者。

请不要在公开 Issue 中直接贴出 Cookie、Token、账号信息、私密链接或可复现的敏感数据。

## Sensitive Data

LumiField 不应收集或上传用户 Cookie。用户登录状态应保存在本地用户数据目录中。

如果你要提交问题反馈，请先确认没有附带：

- `.cookie`
- `.qq-cookie`
- 本地音乐文件
- 用户账号截图
- 调试日志中的 Cookie、Token 或隐私路径
