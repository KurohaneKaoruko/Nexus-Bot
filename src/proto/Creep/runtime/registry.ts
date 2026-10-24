// @ts-nocheck

type RoleHandler = {
    prepare?: (creep: Creep) => boolean;
    run: (creep: Creep) => void;
};

type MissingRoleHandlerReporter = (id: string) => void;

import {
    makeCombatHealHandler, oneRanged, aio, doubleAttack, doubleDismantle,
} from '@/modules/teams';
import { defend2Attack, defendAttack, defendRanged } from '@/modules/defense';
import pcHeal from '@/proto/PowerCreep/mode/assistHeal';
import { EXECUTORS, UNITS } from '@/constant/CreepConstant';

// 键统一引用 EXECUTORS 常量（派生自 UnitData[].executor），与孵化侧词表单一来源对齐
export const roleRegistry: Record<string, RoleHandler> = {
    [EXECUTORS.aio]: aio,
    // 治疗型角色：策略在注册时按角色 id 预绑定，运行时零查表
    [EXECUTORS['deposit-heal']]: makeCombatHealHandler(UNITS['deposit-heal']),
    [EXECUTORS['defend-2heal']]: makeCombatHealHandler(UNITS['defend-2heal']),
    [EXECUTORS['double-heal']]: makeCombatHealHandler(UNITS['double-heal']),
    [EXECUTORS['double-attack']]: doubleAttack,
    [EXECUTORS['double-dismantle']]: doubleDismantle,
    [EXECUTORS['one-ranged']]: oneRanged,
    [EXECUTORS['pc-heal']]: pcHeal,
    [EXECUTORS['defend-2attack']]: defend2Attack,
    [EXECUTORS['defend-attack']]: defendAttack,
    [EXECUTORS['defend-ranged']]: defendRanged,
};

export const getRoleHandler = (id: string, onMissing?: MissingRoleHandlerReporter): RoleHandler | null => {
    const handler = roleRegistry[id];
    if (handler) return handler;
    onMissing?.(id);
    return null;
};
