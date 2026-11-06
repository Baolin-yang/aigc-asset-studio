# 产品说明：AIGC Asset Studio

## 一句话定位

AIGC Asset Studio 把“模型生成”变成“可复用的内容生产资产”：一端接收真实物品照片，另一端输出可以进入世界场景、镜头模板和广告成片的版本化资产。

## 两条工作流

### 1. 资产库到广告短片

适合已有合格 3D 资产的重复生产场景。

```text
Published asset
  → 选择场景与镜头模板
  → 复用已有镜头或重新渲染
  → 字幕 / 配音 / 后期合成
  → 记录 asset revision、shot manifest、usage record
```

这一条解决的是“同一件商品换场景、换镜头、换文案时，不要重新建模”。

### 2. 图生 3D 到世界模型

适合第一次出现的新物品。

```text
照片
  → 输入质量检查
  → Hunyuan3D / Object Capture 候选
  → 尺寸、方向、几何和外观核验
  → 放进世界场景
  → 镜头规划
  → 广告成片
```

这一条解决的是“图生 3D 结果如何离开模型预览，进入可拍摄、可验收的生产环境”。

## 为什么 Demo Provider 仍然有价值

真实 Hunyuan3D、Object Capture 和 Blender 运行时分别依赖模型权重、GPU/系统能力、渲染器版本和输入输出协议。Demo 默认使用本地可重复的任务响应，保证产品界面、状态机、任务契约和作品包可以被评审者立即运行；设置 `HUNYUAN_API_URL` 后，`ProviderRegistry` 会调用现有 Hunyuan `/generate` 接口并保存 GLB，后续其他 provider 仍可沿用同一产品侧工作流。

这让演示同时具备：

- 可运行：无需下载大模型即可启动页面；
- 可解释：不会把模拟的几何结果误称为真实推理结果；
- 可扩展：Hunyuan3D 和 Blender 有明确的适配位置；
- 可追溯：任务、provider、场景和资产版本在同一份协议中记录。

## 真实 Provider 的接入契约

建议每个 provider 返回以下信息：

```json
{
  "jobId": "provider-job-id",
  "provider": "hunyuan3d",
  "providerVersion": "model-or-workflow-version",
  "inputHash": "sha256:...",
  "status": "completed",
  "artifacts": [
    {"role": "model", "uri": "...", "sha256": "..."},
    {"role": "preview", "uri": "...", "sha256": "..."}
  ],
  "quality": {"scale": "unverified", "approvedShots": ["wide", "medium"]}
}
```

生产环境还应增加资源权限、重试幂等、取消、超时、人工审核和使用回流。页面中展示的“已发布”只代表 Demo 示例数据；真实商品必须经过身份、尺寸、结构、纹理和目标镜头验收。

## GitHub 展示结构

```text
demo/
├── index.html        # 产品页面
├── styles.css        # 视觉系统和响应式布局
├── app.js            # 两条工作流与本地交互
├── server.py         # 零依赖本地服务和 Provider Registry
├── README.md         # 启动、接入和提交说明
└── docs/PRODUCT.md   # 产品定位、架构和真实接入契约
```

建议录制一段 60～90 秒演示：先在资产库选择椅子并生成三镜头广告片，再切换到“图生 3D · 世界”，上传照片、运行五阶段链路，最后导出 manifest。这样能同时证明产品完成度和技术边界。
