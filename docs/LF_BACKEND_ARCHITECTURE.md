# LF 后台监控架构

## 组件

- LF 桌面端：Electron 渲染层只持有无权限的会话标记；访问/刷新令牌由主进程通过 Windows `safeStorage` 加密保存。所有角色、开发权限、拉黑和发布状态均由后端返回。
- LF 后台服务：`desktop/lf-backend-service.js` 可独立运行，向 PC 与手机端提供同一套 `/v1` REST API。
- LF 数据层：`desktop/lf-backend.js` 使用 SQLite WAL，新密码采用 bcrypt cost 12；旧 PBKDF2 记录在首次成功登录后自动升级。
- LF 后台监控：独立 Electron 窗口 `lf-monitor.html`，每 2 秒从后端刷新真实统计；普通用户请求会被后端拒绝。
- 本机开发模式：未配置 `LF_REMOTE_API_URL` 时，桌面端启动仅绑定回环地址的本地服务；生产环境配置 HTTPS 远端地址后，PC 和手机共享远端数据库。

## 数据模型

`users`、`user_identities`、`user_sessions`、`login_logs`、`devices`、`feedbacks`、`update_releases`、`update_targets`、`user_permissions`、`ban_records`、`verification_codes`、`verification_attempts`、`audit_logs`，以及一次性二维码、验证票据、OAuth state、密码重置票据和系统版本元数据表。

数据库不保存明文密码，不向管理端返回密码哈希或盐。邮箱统一小写，内地手机号统一为 `+86` E.164；身份值唯一。验证码只保存 SHA-256 摘要，5 分钟失效且原子化单次消费；每账号 60 秒冷却、一小时最多 5 次，并有 IP 小时限流。二维码 3 分钟失效且只能消费一次。访问令牌和刷新令牌分别最长 30 天和 90 天，数据库只保存摘要。

## 部署与双端同步

```text
PC LF ─┐
       ├── HTTPS /v1 API ── SQLite/PostgreSQL 可替换数据层 ── LF 后台监控
手机 LF ─┘
```

独立服务启动：`npm run start:lf-backend`。生产环境至少配置：

- `LF_DATABASE_PATH`
- `LF_API_HOST`、`LF_API_PORT`、`LF_API_ALLOWED_ORIGINS`
- 反向代理 HTTPS
- 桌面端 `LF_REMOTE_API_URL`
- `LF_BOOTSTRAP_ADMIN_EMAILS`、`LF_BOOTSTRAP_ADMIN_PHONE`、`LF_BOOTSTRAP_ADMIN_PASSWORD`
- SMTP：`LF_MAIL_HOST`、`LF_MAIL_PORT`、`LF_MAIL_SECURE`、`LF_MAIL_USER`、`LF_MAIL_PASSWORD`、`LF_MAIL_FROM`
- 短信能力已移除：不读取 `LF_SMS_*`，不提供短信验证码、手机号登录或短信服务测试；历史手机号仅以 `phone_legacy` 迁移标识保留。
- `LF_WECHAT_OAUTH_URL`、`LF_QQ_OAUTH_URL`
- `LF_UPDATE_PUBLIC_KEY`（可选覆盖；桌面包默认使用 `build/lf-update-public.pem`）

未配置邮件或官方 OAuth 时，客户端只显示安全的服务不可用提示，不会伪造发送或登录成功；缺失变量名仅写入管理员审计。只有显式设置 `LF_ALLOW_LOCAL_CODES=1` 的开发进程才返回动态邮件测试验证码；正式打包强制禁用并绝不回传验证码。短信入口、配置和投递代码均已移除。

## 权限与发布

- 管理员由私有 `.env` 的 Bootstrap Admin 幂等初始化；多个邮箱/手机号绑定同一 `user_id`，保留标识禁止普通注册，前端不能自行提升角色。
- 开发权限和拉黑状态按 `user_id` 单独存储；拉黑会撤销该用户 PC/手机全部会话。
- 普通用户的 DevTools 被禁用；Electron 启用 ASAR、沙箱、导航限制和安全熔断（禁用 RunAsNode、NODE_OPTIONS、CLI inspect），访问开发接口会写入审计日志，但不会扫描私人文件。
- 新构建自动生成语义化版本和源码 SHA-256，进入 `pending`；只有管理员确认且更新包 SHA-256 与数字签名通过后才可发布。
- 用户端只接收 `published` 版本并自行决定更新；桌面主进程使用本机配置/随包公钥再次校验 `version:sha256` 数字签名与文件 SHA-256，失败保留当前版本与登录状态。旧 `/api/update/*` 更新链默认停用。
- 发布私钥不打包、不提交；`npm run release:sign -- <安装器路径> <语义化版本>` 生成 `.release.json`，并在写入前完成签名自检。

## 离线策略

已登录用户可使用最长 7 天的本地会话缓存继续使用本地视觉功能；用户导入的本地音频会写入 IndexedDB 离线媒体库（最多保留最近 12 首、单文件上限 512 MB），可在“我的”中播放。歌词、封面、壁纸和设置沿用本地持久化。离线时禁止在线搜索、注册新账号、刷新云歌单、检查更新；反馈带离线标记进入队列。恢复联网后立即重新验证会话和拉黑状态。
