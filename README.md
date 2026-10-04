# QM-Simplify：Quine-McCluskey 素蕴含项与覆盖解释后端

Windows 本地运行的布尔函数逻辑化简服务。仅提供 HTTP API 与 CLI，无图形界面。
技术栈：TypeScript + Node.js（>= 22.5，使用内置 `node:sqlite`，无需原生编译）+ SQLite。
不依赖 Docker、WSL、付费服务或任何外部在线 API。

## 功能范围

- 一至六个有序变量的小型布尔函数化简（Quine-McCluskey 算法，自行实现）。
- 输入：变量名列表、ON 集合（函数必须为真的输入编号）、DC 集合（输出任取的输入编号），其余输入属于 OFF。
- 输出：全部可用素蕴含项、逐轮合并记录、覆盖表、一个覆盖所有 ON 且不覆盖 OFF 的积之和表达式、每一步选择理由。
- 不处理：门延迟、失效概率、一般逻辑电路仿真、无限变量规模。

## 快速开始

```powershell
npm install        # 仅安装 typescript / @types/node（开发依赖）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm run demo       # 运行四个内置演示用例
npm start          # 启动 HTTP 服务（默认自动选择空闲端口）
node dist/src/cli.js serve --port=8080   # 指定端口
```

数据目录为项目内 `data/`（默认数据库 `data/qm.sqlite`，可用环境变量 `QM_DB` 覆盖）。

## 位序约定

- 变量按声明顺序排列，`variables[0]` 为最高位。
- 输入编号 `index` 的第 `(nvars-1-i)` 位对应 `variables[i]` 的真假。
  例如变量 `[A,B,C]` 中编号 5 = 二进制 101，即 A=1, B=0, C=1。
- 模式串从左到右对应 `variables[0..n-1]`：`0` 表示该变量取反，`1` 表示原变量，`-` 表示无关位。

## 常量表示

- 空 ON：规范结果为常假，表达式为 `0`，不选出任何项（即使 DC 非空）。
- 全部位置允许为真：合并得到全无关位项 `---...`，即常真项，表达式为 `1`。

## 覆盖正确不等于全局最小

覆盖分两步：

1. 必需项：若某个 ON 编号只被一个素蕴含项覆盖，该项必选。
2. 确定性贪心：对尚未覆盖的 ON，优先选新增覆盖数量多的项；并列时选文字数少的；再并列按模式串字典序（固定排序，结果确定）。

该策略保证覆盖正确（所有 ON 被覆盖、不覆盖任何 OFF，保存前还会对全部
`2^n` 个输入独立枚举核验），但不承诺全局最少项数或最少文字数。
如需精确最小覆盖，需另行实现精确算法（如 Petrick 法），本项目刻意不包含。

## Quine-McCluskey 合并规则

- 起点为 ON 并 DC 的全部最小项。
- 两项可合并当且仅当：无关位位置完全相同（mask 相同），且固定比特恰好一位相反。
- 每轮记录来源项 id（含同一产物的多组来源对）、去重、是否继续被合并。
- 无法再扩展的项为素蕴含项；DC 项参与全部合并轮次（不会提前丢弃，避免遗漏合法合并），
  但最终只覆盖 DC、不覆盖任何 ON 的项不进入可用素蕴含项表。

## HTTP API

默认监听 `127.0.0.1`，端口默认由系统分配（启动日志打印实际端口），可用 `--port=` 或 `PORT` 环境变量指定。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/functions` | 创建函数并计算（体：`{"variables":["A","B"],"on":[1,2],"dc":[3]}`） |
| GET | `/api/functions` | 列出全部函数 |
| GET | `/api/functions/:id` | 查看函数 |
| PUT | `/api/functions/:id` | 修改集合，创建新版本（同 groupId，version+1） |
| POST | `/api/functions/:id/validate` | 仅校验，不保存 |
| GET | `/api/functions/:id/primes` | 全部可用素蕴含项 |
| GET | `/api/functions/:id/rounds` | 逐轮合并记录（含来源与去重） |
| GET | `/api/functions/:id/cover-table` | 素蕴含项 x ON 覆盖表 |
| GET | `/api/functions/:id/expression` | 表达式与每步选择理由 |
| POST | `/api/functions/:id/eval` | 求值：`{"index":5}` 或 `{"assignment":{"A":1,"B":0}}` |
| GET | `/api/functions/:id/report?page=1&size=100` | 导出报告（分页仅为展示方式，全部素蕴含项均已生成并存库） |

### 错误码

`BAD_REQUEST`、`INVALID_VAR_COUNT`（变量数须为 1-6）、`INVALID_VAR_NAME`、
`DUP_VARIABLE`、`INDEX_OUT_OF_RANGE`、`ON_DC_OVERLAP`、`NOT_FOUND`、
`NOT_VERIFIED`（核验未通过，覆盖结果不发布）、`SCALE_LIMIT`（项数超过 20000）、`INTERNAL`。
集合内重复编号会自动去重（不报错）。

## CLI

```powershell
node dist/src/cli.js create '{"variables":["A","B","C"],"on":[1,3,5,7],"dc":[]}'
node dist/src/cli.js list
node dist/src/cli.js primes 1      # 素蕴含项（零一横线模式）
node dist/src/cli.js rounds 1      # 合并轮次与来源
node dist/src/cli.js cover 1       # 覆盖矩阵
node dist/src/cli.js expr 1        # 表达式与选择理由
node dist/src/cli.js eval 1 5      # 求值
node dist/src/cli.js report 1      # 完整报告
node dist/src/cli.js update 1 '{"variables":["A","B","C"],"on":[0,7]}'
node dist/src/cli.js demo
```

## 持久化与核验

- SQLite 冻结：变量顺序、ON/DC、算法版本、全部合并项及来源、素蕴含项、覆盖选择与表达式。
- 结果先对全部 `2^n` 个输入做独立真值核验（ON 为真、OFF 为假、DC 不限），
  通过后才在单个事务中以 `verified` 状态整体提交；失败则状态为 `failed`，不发布任何覆盖结果。
- 修改集合会创建新版本，旧版本与旧报告保留，重启后仍可查询与求值。

## 测试

`npm test` 覆盖：

- 四个演示用例的表达式真值核验；
- 1-4 变量随机用例：与暴力枚举全部 0/1/- 模式（合法、最大、覆盖 ON）得到的素蕴含项集合逐一比对；
- 集合重排不变性、重复合并来源记录、空 ON、常真项；
- 参数校验错误码；
- SQLite 持久化：关闭重开数据库后查询与求值、修改集合产生新版本。

## 已知限制

- 变量数上限 6（真值表最大 64 行）；合并项总数上限 20000，超出报 `SCALE_LIMIT`。
- 贪心覆盖不保证全局最小（见上文）。
- 服务仅监听本机回环地址，无认证，面向本地单机使用。
- `node:sqlite` 在 Node 25 仍打印 ExperimentalWarning，不影响功能。
