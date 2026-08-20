(function (root, factory) {
  'use strict';
  var content = factory();
  if (typeof module === 'object' && module.exports) module.exports = content;
  if (root) root.LumiFieldLegalContent = content;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { freeze(value[key]); });
    return Object.freeze(value);
  }

  var common = {
    version:'1.1.44',
    effectiveDate:'2026-08-20',
    contact:'应用内“我的 → 反馈问题”；邮箱：3599284614@qq.com / 15037841583@139.com。'
  };

  return freeze({
    version:common.version,
    effectiveDate:common.effectiveDate,
    contact:common.contact,
    privacy:{
      title:'LumiField 隐私说明',
      intro:'本说明适用于 LumiField Windows 桌面端。它按当前实际功能说明数据在本机、LumiField 账号服务及外部服务之间如何流动；不会把“本地处理”误写成“完全没有数据”。',
      sections:[
        { id:'local-data', title:'1. 本地数据与用户选择的文件', paragraphs:[
          '界面设置、播放状态与历史、按 LF 账号隔离的音乐平台偏好、壁纸配置等会写入浏览器本地存储或 Electron userData。节拍图、壁纸转码、分轨、离线音乐、封面及响应缓存可能占用本机磁盘。',
          '只有在用户选择或启用相应功能时，LumiField 才读取本地音乐、图片、视频或反馈附件。播放、解码、转码和分析需要读取文件内容与路径；这些内容不会因为被选中就自动提交给 LumiField 账号服务。'
        ]},
        { id:'lf-account', title:'2. LumiField 账号、会话与完整性记录', paragraphs:[
          'LF 账号可处理用户 ID、邮箱或账号标识、昵称与头像（如有）、登录方式、设备标签、软件版本、登录时间、在线/活跃状态，以及用户授权后提供的登录地点文字。密码保存为安全哈希，不保存明文。',
          '本机会保存登录会话句柄和最多 7 天的离线资料缓存；服务端普通会话最长 30 天、刷新凭据最长 90 天。退出登录会清除本机会话和离线资料缓存，但不会自动删除服务端账号、反馈或审计记录。',
          '完整性保护会使用本机随机设备 ID，并检查 LF 安装清单内文件的相对路径、预期/实际 SHA-256、异常类型和时间；它不以此功能扫描安装目录以外的私人文件正文。'
        ]},
        { id:'music-accounts', title:'3. 五个音乐平台账号、Cookie 与 session', paragraphs:[
          '网易云音乐、QQ 音乐、酷狗、酷狗概念版和汽水音乐账号与 LF 账号相互独立。登录窗口或手动导入产生的 Cookie/session 会保存在当前 LF 账号范围内的 Electron 隔离分区和本地音乐服务中，用于向对应音乐平台验证会话、读取资料/歌单/歌词和请求播放资源。',
          '这些凭据不会作为 LF 账号密码使用，但会在本机进程之间传递，并按功能需要发送给对应音乐平台。各平台可能依据其规则记录 IP、设备、请求和账号活动；用户应自行确认有权登录及使用相关内容。'
        ]},
        { id:'api-ai', title:'4. API Key 与 AI Provider', paragraphs:[
          '远程歌词翻译是可选能力：只有管理员同时配置 LF_TRANSLATE_ENDPOINT 与 LF_TRANSLATE_API_KEY 时，歌词行、源语言和目标语言才会发送到该 HTTPS 翻译/AI Provider；API Key 由本地服务从运行环境读取，不下发到网页界面。',
          '未配置、配置不完整或远程调用失败时会使用本地翻译路径。LumiField 不承诺任意第三方 AI Provider 的保密、可用性或输出准确性；配置者必须审查其隐私条款、数据保留和使用许可。'
        ]},
        { id:'camera-microphone', title:'5. 摄像头与麦克风', paragraphs:[
          '手势控制启用后才请求摄像头权限，视频帧用于本机渲染进程中的手势识别；LumiField 不会主动把摄像头帧提交给 LF 账号服务或音乐平台。MediaPipe 运行资源可能通过网络加载，Windows、驱动或运行库仍可能执行其自身的数据处理。',
          '语音助手的语音唤醒启用后才请求麦克风权限，并使用 Windows 语音识别链路生成文本命令。关闭总开关或语音唤醒会停止识别进程和媒体轨道。系统权限、设备驱动及 Windows 语音组件适用其各自规则。'
        ]},
        { id:'weather-location', title:'6. 天气与位置', paragraphs:[
          '用户输入的天气城市会保存在本机。自动定位使用公网 IP 查询服务获得城市、坐标和时区，再向天气服务请求预报；当前功能不调用浏览器 GPS/精确地理位置接口。',
          'IP 定位与天气服务会看到请求 IP、坐标/城市、时间和常规网络元数据。用户可以改用手动城市，并可清除本机天气缓存或相关本地设置。'
        ]},
        { id:'network-third-parties', title:'7. 网络请求与第三方服务', paragraphs:[
          '联网功能会按实际操作访问 LF 账号/反馈/更新服务、五个音乐平台、天气与 IP 定位服务、可选翻译 Provider，以及功能所需的运行库或资源地址。搜索、播放、歌词、歌单、登录、更新和反馈均可能产生网络请求。',
          '外部服务可能根据自己的条款处理账号标识、Cookie、IP、User-Agent、查询词、歌曲/歌单标识、歌词文本或故障信息。离线模式不会使已经启动的所有第三方组件自动获得相同隐私保证。'
        ]},
        { id:'logs-cache', title:'8. 日志、本地缓存与反馈', paragraphs:[
          '本机可能保存启动、服务、更新、完整性和故障日志，内容可包括时间、错误码、功能状态、安装清单相对路径或必要的诊断信息。日志不会自动等同于已发送反馈。',
          '只有用户主动提交反馈时，反馈文字、必填联系方式、设备/版本摘要以及用户选择的附件才会上传；附件可能包含用户自行提供的日志或媒体。提交前应检查并移除不希望披露的内容。缓存用于性能、离线播放和恢复，可随功能使用而增长。'
        ]},
        { id:'delete-data', title:'9. 删除、退出与保留范围', paragraphs:[
          '退出 LF 账号会删除本机会话和离线账号资料；退出某个音乐平台会清理其隔离分区中的 Cookie、localStorage、IndexedDB 和 CacheStorage，并尝试清理本地音乐服务会话。壁纸等功能提供各自的“清除”入口。',
          'v1.1.44 没有“一键删除全部 LF 账号和全部本机数据”的界面。完整删除本机数据需要先退出应用，再由用户删除 LumiField 的 Windows userData/缓存目录；卸载程序不保证删除这些用户数据。服务端账号、反馈或审计记录的查询/删除请求请通过反馈入口或联系邮箱提出。'
        ]},
        { id:'license-update-contact', title:'10. 开源、更新与联系', paragraphs:[
          'LumiField 项目代码按仓库中的 GPL-3.0-only 许可证发布；第三方代码、模型、字体和素材仍适用 NOTICE 及各自许可证。开源代码许可不等于音乐、封面、歌词、用户文件或第三方账号内容的版权许可。',
          '检查更新会发送当前版本和必要的账号/目标状态；当前界面在下载与验证更新包前征求用户确认。隐私说明会随真实功能变化更新，不会以文案承诺替代尚未实现的控制。联系：' + common.contact
        ]}
      ]
    },
    agreement:{
      title:'LumiField 用户协议',
      intro:'使用 LumiField 表示用户理解本协议以及隐私说明中列出的本地处理、联网请求和第三方服务边界。若不同意，请停止使用需要相应数据或权限的功能。',
      sections:[
        { id:'scope', title:'1. 服务范围', paragraphs:[
          'LumiField 是 Windows 音乐播放与可视化软件，提供本地播放、五平台登录与歌单访问、歌词/翻译、壁纸、视觉效果、语音与手势控制、反馈和更新等能力。具体能力取决于版本、设备、网络、第三方平台和用户授权。'
        ]},
        { id:'accounts', title:'2. 账号与安全', paragraphs:[
          '用户应提供真实可用的 LF 账号信息并妥善保管登录设备。LF 账号与音乐平台账号独立；不得把 LF 会话、音乐平台 Cookie、API Key 或验证码交给不受信任的人。发现异常应退出相关账号并修改对应服务凭据。',
          '不得伪造身份、绕过服务端安全状态、攻击接口、读取其他用户范围的数据或利用应用从事未授权访问。对 GPL 源码的合法使用、研究、修改和再分发权利不因本条受到限制，但连接官方账号/反馈/更新服务时仍须遵守安全边界。'
        ]},
        { id:'music-platforms', title:'3. 第三方音乐平台', paragraphs:[
          '用户只能登录自己有权使用的网易云音乐、QQ 音乐、酷狗、酷狗概念版或汽水音乐账号，并遵守对应平台的服务条款、地区限制和会员规则。LumiField 不保证第三方接口长期可用，也不授予下载、传播、破解或规避付费限制的权利。',
          '第三方平台的账号封禁、内容下架、音质限制、接口变化和数据处理由该平台负责。用户主动导入 Cookie 时，应理解凭据泄露可导致账号风险。'
        ]},
        { id:'files-permissions', title:'4. 本地文件、摄像头、麦克风与位置', paragraphs:[
          '用户应确保有权让应用读取所选音乐、图片、视频和反馈附件，并自行保留重要文件备份。转码、缓存、分轨和分析会消耗磁盘、CPU/GPU 和内存。',
          '摄像头、麦克风和自动 IP 定位均只应在用户需要相应功能时启用。用户可通过功能开关、Windows 权限设置或改用手动天气城市限制这些能力。'
        ]},
        { id:'api-ai', title:'5. API Key、翻译与 AI Provider', paragraphs:[
          '配置外部翻译/AI Provider 的人员负责取得合法 API Key、控制费用与配额，并确认歌词文本可以发送给该服务。不得把第三方密钥写入歌曲、歌单、反馈或可公开共享的预设。',
          '机器翻译和 AI 输出可能错误、不完整或不适合具体语境，用户应自行核对；LumiField 不把自动输出视为专业意见或版权归属证明。'
        ]},
        { id:'responsibility', title:'6. 合法使用与用户责任', paragraphs:[
          '用户不得利用 LumiField 侵害他人账号、隐私、著作权、商标权或其他合法权益，不得上传恶意程序、违法内容或含有无权披露的个人信息。用户对自己选择的文件、账号、查询、反馈和网络配置负责。'
        ]},
        { id:'copyright', title:'7. 音乐与内容版权', paragraphs:[
          '歌曲、封面、歌词、视频壁纸、用户导入素材和第三方平台数据的权利属于各自权利人。LumiField 仅提供播放器和呈现工具；显示、缓存或技术处理不代表获得复制、公开传播或商业使用授权。',
          '公开分享截图、录屏、预设或安装包前，用户应分别核查其中音乐、字体、图像、视频、模型和第三方代码的许可。'
        ]},
        { id:'open-source', title:'8. 开源许可证', paragraphs:[
          'LumiField 源码按 GPL-3.0-only 提供，复制、修改和分发时必须满足该许可证。第三方组件、模型及素材按 NOTICE 和其单独许可证处理；不得删除版权与许可证声明，也不得把参考视频或未获授权素材误当作项目源码许可的一部分。'
        ]},
        { id:'availability', title:'9. 可用性与风险', paragraphs:[
          '软件按当前版本实际状态提供。网络故障、第三方接口变化、账号状态、硬件驱动、媒体格式或系统策略可能导致部分功能不可用。LumiField 会尽量报告可见错误，但不承诺无中断、所有内容可播放或所有自动分析绝对准确。'
        ]},
        { id:'updates', title:'10. 更新与版本变化', paragraphs:[
          '应用可查询发布版本、显示更新说明，并在用户确认后下载和校验更新包。功能、依赖、数据范围或第三方接口变化时，协议与隐私说明可能同步修订；已公开冻结版本不会因后续修订被静默替换。'
        ]},
        { id:'exit-delete', title:'11. 退出、删除与终止使用', paragraphs:[
          '用户可退出 LF 或音乐平台账号、关闭权限功能、清除功能缓存并停止使用。退出不等于删除服务端账号、反馈或审计记录；当前版本没有一键删除全部数据的界面，完整范围和请求方式以隐私说明为准。'
        ]},
        { id:'contact', title:'12. 联系方式', paragraphs:[
          '问题、数据请求、版权通知或安全报告请使用' + common.contact
        ]}
      ]
    }
  });
});
