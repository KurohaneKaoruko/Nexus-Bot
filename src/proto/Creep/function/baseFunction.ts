
/**
 * 一些基础的功能
 */
import { inWhitelist } from '@/utils/whitelist';

export default class BaseFunction extends Creep {
    override disableAttackNotificationsOnce(): void {
        if (this.memory.notified) return;
        this.notifyWhenAttacked(false);
        this.memory.notified = true;
    }

    override isWhiteList() {
        return inWhitelist(this.owner.username);
    }
}
