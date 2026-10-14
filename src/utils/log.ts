/**
 * 统一日志输出: 单参数 = 纯文本; 双参数且第二参数为 string = [类型] 文本;
 * 其余参数透传 console。优先走引擎 logUnsafe 通道 (sim/私服兼容)。
 */
import { BASE_CONFIG } from '@/constant/BaseConstant';

export function log(text: string, ...args: any[]): void;
export function log(type: string, text: string, ...args: any[]): void;
export function log(typeOrText: string, textOrArg?: any, ...args: any[]) {
    const write = (message: string, rest: any[]) => {
        if (typeof (console as any) ['logUnsafe'] === 'function') {
            (console as any) ['logUnsafe'](message, ...rest);
        } else {
            console.log(message, ...rest);
        }
    };

    if (typeof textOrArg === 'string') {
        const type = typeOrText || `${BASE_CONFIG.BOT_NAME}`;
        const text = textOrArg;
        const str = `<span style="color: #D0CAE0;"><b>[${type}]</b></span> ${text}`;
        write(str, args);
        return;
    }

    const text = typeOrText;
    const rest = textOrArg === undefined ? args : [textOrArg, ...args];
    write(text, rest);
}
