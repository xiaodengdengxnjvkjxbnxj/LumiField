# LumiField Windows Installer Style and Safety

本文记录当前 LumiField 安装器的视觉与安全基线。历史产品名称、历史安装目录和历史卸载器只允许由隔离的兼容迁移逻辑识别，不得重新出现在当前安装界面、快捷方式、注册信息或发行文件名中。

## 视觉方向

- 中文极简安装器。
- 主色为白底 `#FFFFFF`、主文字 `#111217`、弱文字 `#4B5263` / `#6B7280`、蓝色点缀 `#3257F7`。
- 不使用旧 Logo、旧产品名、深色大卡片、复杂装饰或大段英文说明。
- 顶部横幅与侧边图使用 `build/installerHeader.bmp`、`build/installerSidebar.bmp`。

## 当前品牌与路径

- 安装器、卸载器、Windows 应用列表、桌面快捷方式和开始菜单统一显示 `LumiField`。
- 安装包文件名为 `LumiField-<version>-Setup.exe`，主程序为 `LumiField.exe`。
- 默认路径从 `D:\LumiField` 开始，按 D-Z 选择第一个存在的非系统盘；只有不存在 D-Z 盘时才使用 `C:\LumiField`。
- 选择盘符根目录时自动补为独立的 `LumiField` 子目录。
- 当前安装根标记为 `.lumifield-install-root`，内容包含 `appId=com.lumifield.desktop`。

## 技术边界

- 使用 `build/installer.nsh` 的自定义欢迎页和目录页。
- `package.json` 的 `build.nsis.allowToChangeInstallationDirectory` 保持 `false`，目录选择由经过安全校验的自定义页面处理。
- 自定义目录页保留可编辑输入框和 `浏览...` 按钮。
- 非空且无法识别为 LumiField 专属目录的目标必须拒绝，避免卸载阶段删除用户文件。
- 安装器和卸载器禁止使用 `RMDir /r $INSTDIR`；只能删除清单内的 LumiField/Electron 文件，最后非递归尝试移除空目录。
- 历史安装兼容只能识别、隔离或迁移既有目录，不得把历史名称写入新的产品路径、注册表、快捷方式或用户可见文案。

## 发布前验证

- 欢迎页、目录页、卸载页和错误提示只显示 LumiField。
- 默认目录、手工选择目录和仅 C 盘场景均符合上述规则。
- `浏览...` 可打开中文文件夹选择窗口。
- 安装后主程序、桌面快捷方式、开始菜单、Windows 应用列表和卸载器均使用 LumiField 名称与图标。
- 安装目录包含 `.lumifield-install-root`，不包含旧品牌命名的当前运行文件。
- 卸载只删除受清单和标记保护的 LumiField 文件，不递归删除混合目录。
