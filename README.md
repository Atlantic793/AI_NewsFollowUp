# headline-chaser

采集各家大模型官网的价目、公开榜、热榜和官方动态，洗成表，并和上一份做差分。

页面是首页、数据页、定制和采集。抓哪些地址、怎样留原文，见 [docs/数据采集与处理.md](docs/数据采集与处理.md)。

## 启动

```powershell
conda env create -f environment.yml
conda activate headline-chaser
npm ci
npm run dev
```

浏览器打开 Vite 提示的地址。接口在 `http://127.0.0.1:4177`。

数据集写在本机应用数据目录的 `headline.sqlite`，不进仓库。
