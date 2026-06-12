import assert from "node:assert/strict";

import { parsePdfAbstractText } from "./backfill-pdf-abstracts.mjs";

assert.deepEqual(parsePdfAbstractText(`
  王弟海 等 ： 产业结构变化机制及其对经济增长的影响
  内容提要 ： 本文主要研究产业结构变化机制及其对经济增长的影响，并论证了保持制造业合理比重的必要性。
  本文理论模型分析表明，由于工业部门比服务业部门具有更快的技术进步率。
  关键词 ： 产业结构　技术进步　干中学　经济增长
  一 、 引言
`), {
  abstract: "本文主要研究产业结构变化机制及其对经济增长的影响，并论证了保持制造业合理比重的必要性。本文理论模型分析表明，由于工业部门比服务业部门具有更快的技术进步率。",
  keywords: ["产业结构", "技术进步", "干中学", "经济增长"],
});

assert.deepEqual(parsePdfAbstractText(`
  摘 要: 返乡创业试点政策是推进城乡融合发展的重要政策工具。本文基于县域面板数据检验政策影响机制。
  关 键 词: 返乡创业；城乡融合；政策试点
  中图分类号：F32
`), {
  abstract: "返乡创业试点政策是推进城乡融合发展的重要政策工具。本文基于县域面板数据检验政策影响机制。",
  keywords: ["返乡创业", "城乡融合", "政策试点"],
});

assert.deepEqual(parsePdfAbstractText(`
  内容提要：本文讨论前沿技术路线布局与研发资助策略，并分析外部时间压力如何影响企业创新激励和政策选择。
  关键词：大 国 科 技 竞 争 外 部 时 间 压 力 创 新 激 励 政 策 技 术 路 线 布 局
  一、引言
`), {
  abstract: "本文讨论前沿技术路线布局与研发资助策略，并分析外部时间压力如何影响企业创新激励和政策选择。",
});

assert.deepEqual(parsePdfAbstractText("目录 参考文献 下载"), {});

console.log("pdf abstract backfill rules ok");
