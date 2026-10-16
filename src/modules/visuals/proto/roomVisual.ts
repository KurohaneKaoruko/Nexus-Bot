// @ts-nocheck

export const colors = {
    white: '#ffffff',
    gray: '#555555',
    light: '#AAAAAA',
    road: '#666',
    energy: '#FFE87B',
    power: '#F53547',
    dark: '#181818',
    outline: '#8FBB93',
    red: '#fe0000',
    blue: '#001eff',
    yellow: '#ffe700',
    green: '#74ee15',
    cyan: '#4deeea',
    black: '#000000',
    orange: '#FFA500',
}

type TuplePoint = [number, number]

function calculateFactoryLevelGapsPoly(): TuplePoint[] {
    let x = -0.08
    let y = -0.52
    const result: TuplePoint[] = []

    const gapAngle = 16 * (Math.PI / 180)
    const c1 = Math.cos(gapAngle)
    const s1 = Math.sin(gapAngle)

    const angle = 72 * (Math.PI / 180)
    const c2 = Math.cos(angle)
    const s2 = Math.sin(angle)

    for (let i = 0; i < 5; ++i) {
        result.push([0.0, 0.0])
        result.push([x, y])
        result.push([x * c1 - y * s1, x * s1 + y * c1])
        const tmpX = x * c2 - y * s2
        y = x * s2 + y * c2
        x = tmpX
    }
    return result
}

const factoryLevelGaps = calculateFactoryLevelGapsPoly()

function relPoly(x: number, y: number, poly: TuplePoint[]) {
    return poly.map(p => ([p[0] + x, p[1] + y] as TuplePoint))
}


export default class RoomVisualExtension extends RoomVisual {
    public structure(x: number, y: number, type: StructureConstant, opts: any = {}) {
        opts = Object.assign(
            {
                opacity: 1
            },
            opts
        )

        switch (type) {
            case STRUCTURE_FACTORY: {
                const outline: TuplePoint[] = [
                    [-0.68, -0.11],
                    [-0.84, -0.18],
                    [-0.84, -0.32],
                    [-0.44, -0.44],
                    [-0.32, -0.84],
                    [-0.18, -0.84],
                    [-0.11, -0.68],

                    [0.11, -0.68],
                    [0.18, -0.84],
                    [0.32, -0.84],
                    [0.44, -0.44],
                    [0.84, -0.32],
                    [0.84, -0.18],
                    [0.68, -0.11],

                    [0.68, 0.11],
                    [0.84, 0.18],
                    [0.84, 0.32],
                    [0.44, 0.44],
                    [0.32, 0.84],
                    [0.18, 0.84],
                    [0.11, 0.68],

                    [-0.11, 0.68],
                    [-0.18, 0.84],
                    [-0.32, 0.84],
                    [-0.44, 0.44],
                    [-0.84, 0.32],
                    [-0.84, 0.18],
                    [-0.68, 0.11]
                ]
                this.poly(outline.map(p => ([p[0] + x, p[1] + y] as TuplePoint)), {
                    fill: null,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                })
                this.circle(x, y, {
                    radius: 0.65,
                    fill: '#232323',
                    strokeWidth: 0.035,
                    stroke: '#140a0a',
                    opacity: opts.opacity
                })
                const spikes: TuplePoint[] = [
                    [-0.4, -0.1],
                    [-0.8, -0.2],
                    [-0.8, -0.3],
                    [-0.4, -0.4],
                    [-0.3, -0.8],
                    [-0.2, -0.8],
                    [-0.1, -0.4],

                    [0.1, -0.4],
                    [0.2, -0.8],
                    [0.3, -0.8],
                    [0.4, -0.4],
                    [0.8, -0.3],
                    [0.8, -0.2],
                    [0.4, -0.1],

                    [0.4, 0.1],
                    [0.8, 0.2],
                    [0.8, 0.3],
                    [0.4, 0.4],
                    [0.3, 0.8],
                    [0.2, 0.8],
                    [0.1, 0.4],

                    [-0.1, 0.4],
                    [-0.2, 0.8],
                    [-0.3, 0.8],
                    [-0.4, 0.4],
                    [-0.8, 0.3],
                    [-0.8, 0.2],
                    [-0.4, 0.1]
                ]
                this.poly(spikes.map(p => ([p[0] + x, p[1] + y] as TuplePoint)), {
                    fill: colors.gray,
                    stroke: '#140a0a',
                    strokeWidth: 0.04,
                    opacity: opts.opacity
                })
                this.circle(x, y, {
                    radius: 0.54,
                    fill: '#302a2a',
                    strokeWidth: 0.04,
                    stroke: '#140a0a',
                    opacity: opts.opacity
                })
                this.poly(factoryLevelGaps.map(p => ([p[0] + x, p[1] + y] as TuplePoint)), {
                    fill: '#140a0a',
                    stroke: null,
                    opacity: opts.opacity
                })
                this.circle(x, y, {
                    radius: 0.42,
                    fill: '#140a0a',
                    opacity: opts.opacity
                })
                this.rect(x - 0.24, y - 0.24, 0.48, 0.48, {
                    fill: '#3f3f3f',
                    opacity: opts.opacity
                })
                break
            }
            case STRUCTURE_EXTENSION:
                this.circle(x, y, {
                    radius: 0.5,
                    fill: colors.dark,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                })
                this.circle(x, y, {
                    radius: 0.35,
                    fill: colors.gray,
                    opacity: opts.opacity
                })
                break
            case STRUCTURE_SPAWN:
                this.circle(x, y, {
                    radius: 0.65,
                    fill: colors.dark,
                    stroke: '#CCCCCC',
                    strokeWidth: 0.10,
                    opacity: opts.opacity
                })
                this.circle(x, y, {
                    radius: 0.40,
                    fill: colors.energy,
                    opacity: opts.opacity
                })
                break
            case STRUCTURE_POWER_SPAWN:
                this.circle(x, y, {
                    radius: 0.65,
                    fill: colors.dark,
                    stroke: colors.power,
                    strokeWidth: 0.10,
                    opacity: opts.opacity
                })
                this.circle(x, y, {
                    radius: 0.40,
                    fill: colors.energy,
                    opacity: opts.opacity
                })
                break
            case STRUCTURE_LINK: {
                let outer: TuplePoint[] = [
                    [0.0, -0.5],
                    [0.4, 0.0],
                    [0.0, 0.5],
                    [-0.4, 0.0]
                ]
                let inner: TuplePoint[] = [
                    [0.0, -0.3],
                    [0.25, 0.0],
                    [0.0, 0.3],
                    [-0.25, 0.0]
                ]
                outer = relPoly(x, y, outer)
                inner = relPoly(x, y, inner)
                outer.push(outer[0])
                inner.push(inner[0])
                this.poly(outer, {
                    fill: colors.dark,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                })
                this.poly(inner, {
                    fill: colors.energy,
                    stroke: false as any,
                    opacity: opts.opacity
                })
                break
            }
            case STRUCTURE_TERMINAL: {
                let outer: TuplePoint[] = [
                    [0.0, -0.8],
                    [0.55, -0.55],
                    [0.8, 0.0],
                    [0.55, 0.55],
                    [0.0, 0.8],
                    [-0.55, 0.55],
                    [-0.8, 0.0],
                    [-0.55, -0.55],
                ]
                let inner: TuplePoint[] = [
                    [0.0, -0.65],
                    [0.45, -0.45],
                    [0.65, 0.0],
                    [0.45, 0.45],
                    [0.0, 0.65],
                    [-0.45, 0.45],
                    [-0.65, 0.0],
                    [-0.45, -0.45],
                ]
                outer = relPoly(x, y, outer)
                inner = relPoly(x, y, inner)
                outer.push(outer[0])
                inner.push(inner[0])
                this.poly(outer, {
                    fill: colors.dark,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                })
                this.poly(inner, {
                    fill: colors.light,
                    stroke: false as any,
                    opacity: opts.opacity
                })
                this.rect(x - 0.45, y - 0.45, 0.9, 0.9, {
                    fill: colors.gray,
                    stroke: colors.dark,
                    strokeWidth: 0.1,
                    opacity: opts.opacity
                })
                break
            }
            case STRUCTURE_LAB:
                this.circle(x, y - 0.025, {
                    radius: 0.55,
                    fill: colors.dark,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                })
                this.circle(x, y - 0.025, {
                    radius: 0.40,
                    fill: opts.isCore ? colors.white : colors.gray,
                    opacity: opts.opacity
                })
                this.rect(x - 0.45, y + 0.3, 0.9, 0.25, {
                    fill: colors.dark,
                    opacity: opts.opacity
                })
                {
                    let box: TuplePoint[] = [
                        [-0.45, 0.3],
                        [-0.45, 0.55],
                        [0.45, 0.55],
                        [0.45, 0.3],
                    ]
                    box = relPoly(x, y, box)
                    this.poly(box, {
                        stroke: colors.outline,
                        strokeWidth: 0.05,
                        opacity: opts.opacity
                    })
                }
                break
            case STRUCTURE_TOWER:
                this.circle(x, y, {
                    radius: 0.6,
                    fill: colors.dark,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                })
                this.rect(x - 0.4, y - 0.3, 0.8, 0.6, {
                    fill: colors.energy,
                    opacity: opts.opacity
                })
                this.rect(x - 0.2, y - 0.9, 0.4, 0.5, {
                    fill: colors.light,
                    stroke: colors.dark,
                    strokeWidth: 0.07,
                    opacity: opts.opacity
                })
                break
            case STRUCTURE_ROAD:
                this.circle(x, y, {
                    radius: 0.175,
                    fill: colors.road,
                    stroke: false as any,
                    opacity: opts.opacity
                })
                break
            case STRUCTURE_RAMPART:
                this.circle(x, y, {
                    radius: 0.65,
                    fill: '#434C43',
                    stroke: '#5D735F',
                    strokeWidth: 0.10,
                    opacity: 0.6
                })
                break
            case STRUCTURE_WALL:
                this.rect(x - 0.5, y - 0.5, 1, 1, {
                    fill: colors.dark,
                    opacity: opts.opacity
                })
                break
            case STRUCTURE_STORAGE: {
                const outline1 = relPoly(x, y, [
                    [-0.45, -0.55],
                    [0, -0.65],
                    [0.45, -0.55],
                    [0.55, 0],
                    [0.45, 0.55],
                    [0, 0.65],
                    [-0.45, 0.55],
                    [-0.55, 0],
                    [-0.45, -0.55],
                ])
                this.poly(outline1, {
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    fill: colors.dark,
                    opacity: opts.opacity
                })
                this.rect(x - 0.35, y - 0.45, 0.7, 0.9, {
                    fill: colors.energy,
                    opacity: opts.opacity,
                })
                break
            }
            case STRUCTURE_OBSERVER:
                this.circle(x, y, {
                    fill: colors.dark,
                    radius: 0.45,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                })
                this.circle(x + 0.225, y, {
                    fill: colors.outline,
                    radius: 0.20,
                    opacity: opts.opacity
                })
                break
            case STRUCTURE_NUKER: {
                let outline: TuplePoint[] = [
                    [0, -1],
                    [-0.47, 0.2],
                    [-0.5, 0.5],
                    [0.5, 0.5],
                    [0.47, 0.2],
                    [0, -1],
                ]
                outline = relPoly(x, y, outline)
                this.poly(outline, {
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    fill: colors.dark,
                    opacity: opts.opacity
                })
                let inline: TuplePoint[] = [
                    [0, -.80],
                    [-0.40, 0.2],
                    [0.40, 0.2],
                    [0, -.80],
                ]
                inline = relPoly(x, y, inline)
                this.poly(inline, {
                    stroke: colors.outline,
                    strokeWidth: 0.01,
                    fill: colors.gray,
                    opacity: opts.opacity
                })
                break
            }
            case STRUCTURE_CONTAINER:
                this.rect(x - 0.225, y - 0.3, 0.45, 0.6, {
                    fill: colors.gray,
                    opacity: opts.opacity,
                    stroke: colors.dark,
                    strokeWidth: 0.09,
                })
                this.rect(x - 0.17, y + 0.07, 0.34, 0.2, {
                    fill: colors.energy,
                    opacity: opts.opacity,
                })
                break
            default:
                this.circle(x, y, {
                    fill: colors.light,
                    radius: 0.35,
                    stroke: colors.dark,
                    strokeWidth: 0.20,
                    opacity: opts.opacity
                })
                break
        }

        return this
    }
}
