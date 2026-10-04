/** 内置演示：DC 扩大蕴含项、多素蕴含项、必需项全覆盖、贪心补选。 */
import { Store } from "./store";
import { patternOf } from "./qm";

export const DEMO_CASES = [
  {
    name: "演示1：DC 帮助扩大蕴含项（无 DC 时 0 与 2 无法并入含 4/6 的组）",
    spec: { variables: ["A", "B", "C"], on: [0, 2], dc: [4, 6] },
  },
  {
    name: "演示2：多个素蕴含项，必需项已覆盖全部 ON",
    spec: { variables: ["A", "B", "C", "D"], on: [4, 8, 10, 11, 12, 15], dc: [] },
  },
  {
    name: "演示3：必需项之外还需贪心补选",
    spec: {
      variables: ["A", "B", "C", "D"],
      on: [0, 2, 5, 6, 7, 8, 10, 13, 15],
      dc: [],
    },
  },
  {
    name: "演示4：经典例子（含 DC，多素蕴含项 + 必需项 + 贪心）",
    spec: {
      variables: ["A", "B", "C", "D"],
      on: [4, 5, 6, 8, 9, 10, 13],
      dc: [0, 7, 15],
    },
  },
];

export function runDemo(store: Store): void {
  for (const c of DEMO_CASES) {
    console.log("=".repeat(60));
    console.log(c.name);
    console.log(
      "变量 [" +
        c.spec.variables.join(", ") +
        "]  ON={" +
        c.spec.on.join(",") +
        "}  DC={" +
        c.spec.dc.join(",") +
        "}"
    );
    const id = store.createFunction(c.spec);
    const f = store.getFunction(id);
    const n = f.variables.length;
    console.log("状态：" + f.status + "（函数 id=" + id + "）");
    console.log("素蕴含项：");
    for (const p of store.getPrimes(id)) {
      console.log(
        "  " + patternOf(p.mask, p.bits, n) + "  覆盖ON [" + p.coversOn.join(", ") + "]"
      );
    }
    console.log("覆盖选择：");
    for (const ch of store.getCoverChoices(id)) {
      console.log(
        "  步骤" +
          ch.step +
          "  " +
          patternOf(ch.mask, ch.bits, n) +
          "  " +
          ch.reason +
          "；新增 [" +
          ch.newlyCovered.join(", ") +
          "]"
      );
    }
    console.log("表达式：F = " + f.expression);
  }
  console.log("=".repeat(60));
  console.log("全部演示已完成真值核验（ON=1、OFF=0、DC 不限）。");
}
