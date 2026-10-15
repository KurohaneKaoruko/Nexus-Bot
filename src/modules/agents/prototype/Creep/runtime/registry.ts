// @ts-nocheck

type RoleHandler = {
    prepare?: (creep: Creep) => boolean;
    run: (creep: Creep) => void;
};

type MissingRoleHandlerReporter = (id: string) => void;

import harvester from '@/modules/economy/units/harvester';
import carrier from '@/modules/economy/units/carrier';
import transporterRole from '@/modules/economy/units/transporter';
import manager from '@/modules/economy/units/manager';
import worker from '@/modules/economy/units/worker';
import minerRole from '@/modules/economy/units/miner';
import upgraderRole from '@/modules/economy/units/upgrader';
import universal from '@/modules/economy/units/universal';
import { makeCombatHealHandler } from '@/modules/teams/units/combatHeal';
import oneRanged from '@/modules/teams/units/one-ranged';
import aio from '@/modules/teams/units/aio';
import doubleAttack from '@/modules/teams/units/double-attack';
import doubleDismantle from '@/modules/teams/units/double-dismantle';
import pcHeal from '@/modules/teams/units/pc-heal';
import { defend2Attack } from '@/modules/teams/units/defend-duo';
import { EXECUTORS, UNITS } from '@/constant/CreepConstant';
import { defendAttack, defendRanged } from '@/modules/teams/units/defend-single';

// 键统一引用 EXECUTORS 常量（派生自 UnitData[].executor），与孵化侧词表单一来源对齐
export const roleRegistry: Record<string, RoleHandler> = {
    [EXECUTORS.carrier]: carrier,
    [EXECUTORS.harvester]: harvester,
    [EXECUTORS.manager]: manager,
    [EXECUTORS.miner]: minerRole,
    [EXECUTORS.transporter]: transporterRole,
    [EXECUTORS.universal]: universal,
    [EXECUTORS.upgrader]: upgraderRole,
    [EXECUTORS.worker]: worker,

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
