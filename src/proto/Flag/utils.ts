
import { sharedBrokerForDirectCommands } from '@/modules/agents/actionBroker'

export const parseFlagNumber = (flagName: string, key: string, defaultValue: number): number => {
    const raw = flagName.match(new RegExp(`/${key}-(\\\\d+)`))?.[1]
    return raw ? parseInt(raw) : defaultValue
}

export const parseFlagToken = (flagName: string, key: string): string | undefined => {
    return (flagName.match(new RegExp(`/${key}-(\\\\w+)`))?.[1] as any) || undefined
}

export const parseSpawnRoomName = (flagName: string): string | undefined => {
    return flagName.match(/\/([EW]\d+[NS]\d+)/)?.[1]
}

export const getSpawnRoomOrRemove = (flag: Flag): Room | undefined => {
    const spawnRoom = parseSpawnRoomName(flag.name)
    const room = spawnRoom ? Game.rooms[spawnRoom] : undefined
    if (!spawnRoom || !room || !room.my) {
        // 旗标作废收编 broker flag 管线 (warSpawn 人操链, 原生调用收编 api/17)
        sharedBrokerForDirectCommands().executeNow({
            id: `warspawn-flag-remove:${flag.name}:${Game.time}`,
            tick: Game.time,
            actorName: flag.pos.roomName,
            kind: 'removeFlag',
            pipeline: 'flag',
            priority: 50,
            payload: { flagName: flag.name },
            dedupeKey: `warspawn-flag-remove:${flag.name}:${Game.time}`,
        })
        return undefined
    }
    return room
}

export const tickThrottle = (flag: Flag, interval: number, key = 'lastTime'): boolean => {
    const mem = flag.memory as any
    if (Game.time - (mem[key] || 0) < interval) return false
    mem[key] = Game.time
    return true
}
