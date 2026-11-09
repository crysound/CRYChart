# CRYChart 消费场景合同

本清单覆盖 OpenTest 使用的 8 个消费主体。BaseChartV2 是共同底座，其余为具体消费入口。Trajectory 包含二维和三维图形。清单只描述本库需要支持的调用和数据要求。

| 消费主体 | 主要要求 |
|---|---|
| BaseChartV2 | 类型化数据集、独立 Y 轴、刻度和游标格式、图例、事件、导出与销毁 |
| TimeWaveform | 自动 Float64 X、原始 Y 与显示 Y 分列、48 kHz 追加、保留窗口与视区 |
| WaveformSingleYAxis | 多条序列共享 Y 轴、显示映射、连续追加与范围检查 |
| TDF | 滚动列、绝对样本索引、NaN 缺帧、强度色表与可见范围保护 |
| Waterfall | 每帧三维折线、时间淘汰、频率对数轴、相机、尺寸变化与释放 |
| Histogram | bin 边界、双 Y 轴、矩形命中、marker、结果表与导出 |
| Trajectory | 二维与三维轨迹、范围、相机、数据命中与生命周期 |
| Polar | 角度和径向数据、marker、结果表、主题与格式化 |

机器可读需求见 [主体清单](native-chart-validation.json) 与 [API 清单](opentest-contract.json)。公开接口规则见 [接口合同](public-api-contract.json)。旧消费源码位置不作为当前产品路径分发。

品牌和接口清理后的当前源码，需要重新执行受影响检查。历史构建的功能数量和性能数值不作为当前通过数。OpenTest 的源码、依赖和缓存保持只读，本清单不证明应用替包、启动或部署已通过。

高精度历史波形的受控负载与长测见 [Scope 复测](performance-scope-high-precision-20261109.md)。该测试不覆盖实际硬件采集、完整进程间通信成本或无限运行时的稳定性。
