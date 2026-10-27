/**
 * 冲级赛布局 (race 专用静态模板)。
 *
 * 上游 speedrun bot 固定坐标布局的主代码化: 模板以 hub1 容器 (17,30) 为中心
 * (相对坐标), 对应落点房 spawn (17,31) / controller (17,25) / 双源 (21,13)(30,29)。
 * extension 建序 = HUBS[0].ext (10) 接 HUBS[1].ext (12), 与 speedrun/layout
 * 的 BAYS 档逐位一致; container 依次为 hub1/hub2/升级块三箱。
 * speedrun/layout 从本模板派生生产档坐标 (变体旋钮留运行时), 主代码管线可
 * 直接以 layoutType='race' 消费——两边对同一房给出同一布局图景。
 *
 * 与其余模板的差异: 不含 storage/terminal/lab 等高本建筑 (冲级赛单房速通,
 * 只建 spawn/extension/container), 道路由 speedrun 铺路体系动态规划 (不入模板),
 * rampart 环由 staticLayout 统一追加。
 */
export default {
    "name": "race",
    "buildings": {
        "spawn": [
            { "x": 0, "y": 1 }
        ],
        "extension": [
            { "x": -2, "y": 1 },
            { "x": -1, "y": 2 },
            { "x": 1, "y": 2 },
            { "x": 2, "y": 1 },
            { "x": 0, "y": 2 },
            { "x": -2, "y": 0 },
            { "x": 2, "y": 0 },
            { "x": -2, "y": 2 },
            { "x": 2, "y": 2 },
            { "x": -1, "y": 0 },
            { "x": 4, "y": 1 },
            { "x": 5, "y": 2 },
            { "x": 7, "y": 2 },
            { "x": 8, "y": 1 },
            { "x": 6, "y": 1 },
            { "x": 4, "y": 0 },
            { "x": 5, "y": 0 },
            { "x": 7, "y": 0 },
            { "x": 8, "y": 0 },
            { "x": 4, "y": 2 },
            { "x": 6, "y": 2 },
            { "x": 8, "y": 2 }
        ],
        "container": [
            { "x": 0, "y": 0 },
            { "x": 6, "y": 0 },
            { "x": -2, "y": -3 },
            { "x": 0, "y": -3 },
            { "x": 2, "y": -3 }
        ]
    }
};
