# AIGC Asset Studio

一个面向 AI Builder 作品提交的可运行 Demo：把“真实物品照片 → 3D 资产 → 世界场景 → 广告短片”和“3D 资产库 → 可复用镜头 → 广告短片”放进同一个生产工作台。

## Demo 能力

- 资产库：浏览已发布的 3D 物品版本、来源、尺寸、可用镜头范围和使用记录。
- 资产到成片：选择一个已核验资产，绑定场景、镜头模板和广告文案，生成可追溯的成片任务。
- 图生 3D：上传参考图，经过照片检查、图生 3D 候选、世界场景、镜头计划和广告成片五个阶段。
- 本地状态：上传图片和最近任务保存在浏览器 localStorage，刷新页面仍可继续演示。
- Provider 适配：默认使用可解释的 Demo Provider；`server.py` 预留 Hunyuan3D 和 Blender 的接入配置，避免把模拟结果误称为真实模型结果。

## 启动

```bash
cd demo
python3 server.py
```

浏览器打开 <http://127.0.0.1:8787>。

也可以指定端口：

```bash
PORT=8890 python3 server.py
```

## 接入真实模型

当前页面默认是可离线展示的 Demo 模式。若本机已经运行了 Hunyuan3D HTTP 服务，可以启动时配置：

```bash
HUNYUAN_API_URL=http://127.0.0.1:8081 python3 server.py
```

`server.py` 中的 `ProviderRegistry` 会调用本仓库 Hunyuan Demo 的 `/generate` 接口，并将返回的 GLB 保存到 `demo/outputs/`。Object Capture、Blender 后台渲染或内部工作流也可以接入同一份任务协议。页面仍然保留任务状态、资产版本和镜头来源。

## 作品提交建议

提交 GitHub 时建议保留：

1. `index.html`、`styles.css`、`app.js`：完整可运行的工作台；
2. `server.py`：本地启动和 Provider 适配；
3. `docs/`：一页产品说明、流程图和真实模型接入说明；
4. `assets/`：仅放 Demo 必需的轻量示例，不上传内部业务数据或受限素材。

## 设计边界

Demo 中的“候选模型已生成”和“镜头已完成”是可重复的本地演示状态。真实 Hunyuan3D、Object Capture 或 Blender 运行时需要各自的模型权重、设备和许可；接入后应把 provider 版本、输入 hash、模型版本、渲染器版本和输出 hash 写入任务记录。
