/**
 * 要塞服编队表层: 一体机小队配置 + ATK 攻击旗解析。
 *
 * @remarks
 * 必须在首次 TeamSpawner 扫描前完成注册; main.ts 的顶层 import 即满足。
 */
import { TeamSpawner } from "@/modules/teams";
import "./aio";
import { atkSpecProvider } from "./atk";

TeamSpawner.registerSpecProvider(atkSpecProvider);
