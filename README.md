# Quine–McCluskey 素蕴含项与覆盖解释后端

一个只做 **API 与 CLI** 的小型布尔函数逻辑化简服务，使用 **TypeScript + Node.js + SQLite**，
在 Windows 本地直接运行，不依赖 Docker、WSL、付费服务或任何外部在线 API。

适用范围：**1～6 个有序变量** 的单输出布尔函数，由 `ON`（必须为 1 的最小项）、
`DC`（无关项 don't-care，输出任取）描述，其余输入属于 `OFF`（必须为 0）。
不处理门延迟、失效概率、一般逻辑电路仿真或无限变量规模。

---

## 1. 位序与输入编号约定

- 变量以 **有序数组** 给出，数组顺序即“变量顺序”，会被冻结保存。
- `variables[0]` 是**最高位（MSB）**，`variables[n-1]` 是最低位（LSB）。
- 输入（最小项）编号 `m` 是该 n 位二进制对应的无符号整数：
  变量 `variables[j]` 取编号的第 `n-1-j` 个比特。

例如 3 变量 `["A","B","C"]`：

| 编号 m | 二进制 ABC | A | B | C |
| --- | --- | --- | --- | --- |
| 0 | 000 | 0 | 0 | 0 |
| 4 | 100 | 1 | 0 | 0 |
| 5 | 101 | 1 | 0 | 1 |
| 6 | 110 | 1 | 1 | 0 |

## 2. 零一横线模式与常量表示

内部用长度 n 的字符串模式表示蕴含项，字符与变量顺序对齐（MSB 起始）：

- `1`：该变量以正文字出现；`0`：以反文字出现（表达式中用撇号，如 `A'`）；
- `-`：该变量已被合并消去（无关位）。
- 乘积项内文字用 `·` 连接，积之和各项用 ` + ` 连接，例如 `A·B' + B·C`。
- **常假**（空 `ON`）表达式为 `0`；**常真**（所有位置都允许/要求为 1）为全横线模式（如 `--`），表达式为 `1`。

## 3. 算法说明（自行实现，非外部求解器）

代码位于 `src/core/`：

1. **起点**：把 `ON ∪ DC` 的最小项作为第 0 轮条目。`DC` 从一开始就参与合并，
   因此不会因为提前丢弃中间 DC 项而遗漏合法合并。
2. **逐轮合并（QM）**：仅当两个条目的所有固定位置模式相同、且**恰好一个固定比特相反**
   （一个 `0` 一个 `1`，其余固定位一致，`-` 与固定位冲突不可合并）时，
   把该位置合并为 `-`。同轮结果按模式去重；每一条合并关系（左/右/结果/轮次）都保留，
   同一结果的多对“重复合并来源”会被记录但不重复。
3. **素蕴含项收集**：每轮标记条目是否继续被合并；最终**无法再扩展**的条目成为素蕴含项。
4. **DC-only 剔除**：可以只覆盖 DC、不覆盖任何 ON 的素蕴含项，保留在“全部素蕴含项”里供审计，
   但**不进入**最终可用素蕴含项表与覆盖表。
5. **覆盖表与选择**：构造“可用素蕴含项 × ON 编号”的覆盖矩阵：
   - 先选**必需项（essential）**：某个 ON 只被唯一一个可用素蕴含项覆盖，则该项必选；
   - 再用**确定性贪心**补选剩余 ON，优先级固定为
     **新增覆盖数量多 → 文字数少 → 模式固定排序**。
     模式固定排序规定字符序 `-` < `0` < `1`，从左到右字典序，保证结果可复现。
6. **真值核验后才发布**：独立枚举全部 `2^n` 个输入，要求表达式在所有 ON 上为 1、
   所有 OFF 上为 0（DC 不作要求）。只有核验通过，结果才以 `status=computed`
   连同表达式、合并关系、覆盖选择一起写入 SQLite；核验失败不会发布半份覆盖。

### “覆盖正确”不等于“全局最小”

本服务**保证**选出的积之和表达式覆盖全部 ON 且绝不覆盖 OFF（结构上 OFF 不参与合并，
并有独立枚举复核）。但第二步采用的是**确定性贪心**，**不承诺**全局最少项数或最少文字数，
也**没有**实现 Petrick 法/分支限界等精确最小覆盖求解器。每个被选项都会返回：
选择理由（必需/贪心）、裁决依据、当时**新增覆盖的 ON 编号**，便于人工核对，而不是只给一串公式。

另有独立交叉核对：对不超过 4 个变量的函数枚举全部 `3^n` 个零一横线模式，
判定其中“合法（不覆盖 OFF）、对蕴含关系极大（不能再消去一个文字）、且覆盖 ON”的集合，
与 QM 产出的可用素蕴含项集合必须完全一致（见测试）。

## 4. 规模限制

- 变量数：`1..6`（最小项编号合法范围 `0..2^n-1`，6 变量时为 `0..63`）。
- 集合内重复编号会被明确去重；`ON` 与 `DC` 重叠直接拒绝。
- 列表接口支持分页，但**分页只是展示窗口**：计算阶段始终生成全部素蕴含项，
  响应中的 `total` 为真实总数，不会把未展示的项当作不存在。

## 5. 环境要求与安装

- Windows + Node.js **>= 22.5**（开发与验证使用 Node v25）。SQLite 使用 Node 内置
  `node:sqlite`，**无需任何原生编译工具链**。

```powershell
npm install
```

## 6. 构建、测试、启动、演示

```powershell
npm run build     # TypeScript 类型检查 + 输出到 dist/
npm test          # 内置 node:test 测试（算法、穷举核对、校验、SQLite 重启）
npm run demo      # 命令行演示四类场景 + 空 ON/常真边界
npm run dev       # 以 tsx 直接启动 API 服务（默认空闲端口）
npm start         # 启动已构建版本（需先 npm run build）
```

启动后会打印实际监听端口（默认 `PORT=0`，由操作系统分配空闲端口）：

```json
{ "status": "listening", "host": "127.0.0.1", "port": 62707, "db": "...\\data\\qmc.db" }
```

可配置项：

- 端口：`--port 8080` 或环境变量 `PORT`；
- 数据库文件：`--db data/custom.db` 或环境变量 `QMC_DB`（默认项目内 `data/qmc.db`）。

## 7. HTTP API

仅监听 `127.0.0.1`，返回 JSON。错误统一形如
`{ "error": { "code": "...", "message": "...", "details": ... } }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/functions` | 创建函数并计算首版本，body：`{name?,variables,on,dc}` |
| GET | `/api/functions` | 列出函数 |
| GET | `/api/functions/:id` | 函数详情与版本列表 |
| POST | `/api/functions/:id/versions` | 用新集合创建**新版本**（旧版本永久保留） |
| GET | `/api/functions/:id/versions/:v` | 读取指定版本完整结果（缺省版本=最新 computed） |
| GET | `/api/functions/:id/primes?dcOnly=&page=&pageSize=` | 素蕴含项（分页；`dcOnly=true` 含 DC-only） |
| GET | `/api/functions/:id/rounds` | 逐轮条目与合并来源关系 |
| GET | `/api/functions/:id/coverage` | 覆盖矩阵与每个选择的理由/新增覆盖 |
| GET | `/api/functions/:id/expression` | 最终表达式、常量类型、选择、展开覆盖编号 |
| GET | `/api/functions/:id/evaluate?input=6` | 求指定输入编号的取值（含 ON/OFF/DC 标注） |
| GET | `/api/functions/:id/verify` | 真值核验结果 |
| GET | `/api/functions/:id/report?page=&pageSize=` | 导出完整报告（仅真值行分页） |

示例（PowerShell）：

```powershell
$body = '{"name":"demo","variables":["A","B","C"],"on":[4,5],"dc":[7]}'
Invoke-RestMethod -Method Post http://127.0.0.1:PORT/api/functions -ContentType 'application/json' -Body $body
```

### 错误码

`INVALID_VAR_COUNT`、`EMPTY_VAR_NAME`、`DUPLICATE_VAR_NAME`、`INVALID_VAR_NAME`、
`MINTERM_OUT_OF_RANGE`、`MINTERM_NOT_INTEGER`、`ON_DC_OVERLAP`、
`FUNCTION_NOT_FOUND`(404)、`VERSION_NOT_FOUND`(404)、`NOT_COMPUTED`(409)、
`INVALID_INPUT_NUMBER`、`INVALID_PAGINATION`、`BAD_REQUEST`。

## 8. CLI

```powershell
npm run cli -- compute --vars A,B,C --on 4,8,10 --dc 0,2   # 计算+落库，打印完整报告
npm run cli -- list                                        # 列出函数
npm run cli -- primes 1 --all                              # 素蕴含项（含 DC-only）
npm run cli -- rounds 1                                    # 零一横线模式 + 逐轮来源 + merged 标记
npm run cli -- coverage 1                                  # 覆盖矩阵与选择理由
npm run cli -- expression 1                                # 最终表达式
npm run cli -- truth 1                                     # 真值表核验
npm run cli -- report 1                                    # 完整文本报告
npm run cli -- eval 1 --input 6                            # 指定输入求值
# 1 可用 id:版本号 读取历史版本，例如 coverage 1:2
```
> CLI 仅输出零一横线模式、合并来源与覆盖矩阵，不提供图形卡诺图编辑器。

## 9. SQLite 持久化与重启

数据库默认在项目内 `data/qmc.db`（WAL 模式）。每个函数的**变量顺序、ON/DC、算法版本、
合并关系、覆盖选择、表达式与核验结果**冻结在一个版本中；修改集合即新建版本，旧版本不被覆盖，
重启后仍可读取旧报告并对其求值。写入在事务内完成，失败仅记 `failed`，不产生半成品 `computed`。

## 10. 目录结构

```
src/
  common/      错误码、规模限制
  core/        QM 合并、模式工具、覆盖选择、表达式、真值核验与穷举交叉核对、服务编排
  db/          SQLite 连接、schema、版本化仓储
  server/      HTTP API 与启动入口（可配置端口/空闲端口）
  cli/         命令行与终端渲染（模式/来源/覆盖矩阵）
  demo/        四类场景 + 边界演示
tests/         node:test 测试
```

