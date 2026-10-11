/**
 * local 变体入口: 本地客户端 / 私服环境。
 */
import './compat';
import { LOCAL_PROFILE } from './profile';
import { bootNexus } from '@/core/boot';
import { createDefaultModules } from '@/modules/index';

export const loop = bootNexus({ profile: LOCAL_PROFILE, modules: createDefaultModules() });
