# headline-chaser

个人工作台。一个主题一份本地档案，服务跑在本机。

## 启动

```text
npm install
npm run dev
```

浏览器打开 Vite 提示的地址，接口在 `http://127.0.0.1:4177`。晨报跟着这个服务进程走，只关浏览器标签不会停。服务端不会热重载，改完服务代码后重新执行 `npm run dev`。

可选环境变量：

```text
OPENAI_BASE_URL
OPENAI_API_KEY
OPENAI_MODEL

密钥只放在环境变量里。不要把 `OPENAI_API_KEY` 写进启动命令，终端记录会留下它。
PORT
FOLLOWUP_DATA_DIR
FOLLOWUP_TOPICS_ROOT
```

没有模型密钥时仍可确认计划和收集。关键词需要自己填，对话会提示还没有配置模型。登记和对话默认写在 `%APPDATA%\AI_NewsFollowUp`，主题文件夹默认在用户主目录的 `AI_NewsFollowUp\topics`。

信息源来自本机 `opencli list search`。写操作不会出现。能搜索但不能收成统一条目的命令会显示为不可选。

```text
npm test
npm run typecheck
npm run lint
```
