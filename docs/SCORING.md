# 可复现评分 scoring-v1

默认配置 `data/scoring-v1.json`：信誉30、网站25、路由20、DNS15、基础网络10。`--scoring FILE.json` 可调整五维权重（合计100）、最低覆盖率、等级和状态因子；完整模型与 SHA-256 写入报告。

每项先形成 `score_input`：0–1因子、样本权重、证据 JSON Pointer、判据。未知因子为 null，不以0处罚。维度贡献 = 维度权重 × 已知样本的加权因子 / 计划样本总权重；有效覆盖 = 维度权重 × 已知样本权重 / 计划总权重。信誉按实际风险来源覆盖计算。总参考分 = 总贡献 / 有效覆盖 ×100；覆盖<60%时 overall=null，只展示局部分数。

网站每站优先采用出口核实的真实浏览器，否则采用出口核实的桌面 HTTP，避免三种请求对同一站重复投票。验证码、登录、429 是受限，空白、JS要求或未知规则不计已知样本。只匿名的路由跳点是未知；实际部分路径默认0.5，到达1；不代表链路等级。DNS按实际查询成功/受限/失败计分，传输原因不明保留未知。基础网络采用各协议族独立 HTTPS 回显的一致性，隐含实际 DNS/TCP/TLS 成功；单源仅0.5，多出口0，未测未知。只显式选择一个协议族时按该族统计，否则双栈各占一半。

住宅、机房、登记年龄与类型可信度不直接加减风险或能力分。`type_confidence`、`risk_level`、`data_freshness` 单列。lookup、port、doctor不产生综合能力分。

```text
node bin/openmili.js score --input openmili-reports/latest.json --json
node bin/openmili.js score --input report.json --scoring data/scoring-v1.json
```

第一条在完全离线下使用报告保存的输入与模型重放，不读取当前公共库；第二条显式选择模型时从原始观测重新归一化。同版本输入与模型相同则输出完全相同。缺失证据不能靠重放补全。
