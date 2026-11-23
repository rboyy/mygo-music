# Pocket Casts for MyGo Music

把 [Pocket Casts](https://pocketcasts.com)（pocketcasts.com）接入 MyGo Music 的插件：订阅、发现、收听进度、标星、队列、文字稿（作为歌词显示）都来自你的 Pocket Casts 账号。

## 安装

Settings > Plugins > + 安装，或者手动把整个 `pocketcasts` 文件夹放进 MyGo Music 的插件目录（Settings > Plugins > + > Show Plugins Folder）。

## 使用

1. 在插件的设置里填写 Pocket Casts 的邮箱和密码（没有账号先去 [pocketcasts.com/register](https://pocketcasts.com/register) 注册，免费账号即可）。
2. 点插件旁边的登录。之后在设置里还可以选「发现页地区」（影响精选/分类榜单）。

## 功能

| | |
| --- | --- |
| 首页 | 继续收听、订阅的最新单集、精选 / 热门 / 最受欢迎、推荐单集 |
| 发现 | Pocket Casts 官方发现页的全部版块：精选、热门上升、最受欢迎、编辑推荐合集 |
| 分类 | 全部分类，每个分类下的热门播客 |
| 搜索 | 搜播客（节目）和搜单集，输入时自动补全 |
| 我的播客 | 订阅列表，进入节目页看全部单集（分页）、评分、简介 |
| 订阅 / 取消订阅 | 直接在节目页操作，与官方各端同步 |
| 接下来播放 | 你的 Up Next 队列 |
| 收听中 / 收听历史 | 服务器同步的收听进度和历史 |
| 已标星 | 标星（喜欢）单集，可直接点赞 / 取消 |
| 电台 | 「为你推荐」电台，由 Pocket Casts 推荐单集驱动 |
| 歌词 | 有官方文字稿（transcript）的单集，按时间轴逐行显示在歌词页 |
| 播放 | 音频取自播客发布方原始 CDN，每次播放取新地址，无需 Plus |

## 说明

- 使用 Pocket Casts 的非官方 API（与 Web 播放器同一套接口），接口变动可能使功能失效。
- 播放进度：MyGo 在单集开始播放时通知插件，插件只在本机记录「最近播放」；精确的收听进度仍由官方 App 同步，插件不做服务端进度写入，避免把进度标错。
- 队列只能看，不能在这里增删（MyGo 没有队列编辑入口）。
- 文件夹、筛选器、书签、上传文件、Plus 的画质选项没有对应的 MyGo 概念，未做。
- Pocket Casts 对部分地区（如中国大陆 IP）有访问限制，播放器和部分接口可能需要网络代理。

## 发布

放到公开 GitHub 仓库（`plugin.json` 在仓库根部），打 tag 发 release（zip 名随意或 `plugin-darwin-arm64.zip`），并给仓库加 topic `mygo-music-plugin`，就会出现在[插件列表](https://mygo-music.egoist.dev/plugins)里。安装链接：`mygo-music://install-plugin?repo=你的用户名/仓库名`。
