import { TeePromise } from "@heyputer/putility/src/libs/promise";
import { Exit } from "../coreutils/coreutil_lib/exit";

export class EmuCommandProvider {
    static AVAILABLE = {
        'bash': '/bin/bash',
        'htop': '/usr/bin/htop',
    };

    static EMU_APP_NAME = 'test-emu';

    constructor () {
        this.available = this.constructor.AVAILABLE;
    }

    async aquire_emulator ({ ctx }) {
        // FUTURE: when we have a way to query instances
        // without exposing the real instance id
        /*
        const instances = await puter.ui.queryInstances();
        if ( instances.length < 0 ) {
            return;
        }
        const instance = instances[0];
        */

        const conn = await puter.ui.connectToInstance(this.constructor.EMU_APP_NAME);
        const p_ready = new TeePromise();
        conn.on('message', message => {
            if ( message.$ === 'status' ) {
                p_ready.resolve();
            }
            console.log('[!!] message from the emulator', message);
        });
        if ( conn.response.status.ready ) {
            p_ready.resolve();
        }
        console.log('awaiting emulator ready');
        ctx.externs.out.write('Waiting for emulator...\n');
        await p_ready;
        console.log('emulator ready');
        return conn;
    }

    async lookup (id, { ctx }) {
        if ( ! (id in this.available) ) {
            return;
        }

        const emu = await this.aquire_emulator({ ctx });
        if ( ! emu ) {
            ctx.externs.out.write('No emulator available.\n');
            return new Exit(1);
        }

        ctx.externs.out.write(`Launching ${id} in emulator ${emu.appInstanceID}\n`);

        return {
            name: id,
            path: 'Emulator',
            execute: this.execute.bind(this, { id, emu, ctx }),
        }
    }

    async execute ({ id, emu }, ctx) {
        // TODO: DRY: most copied from PuterAppCommandProvider
        const resize_listener = evt => {
            emu.postMessage({
                $: 'ioctl.set',
                windowSize: {
                    rows: evt.detail.rows,
                    cols: evt.detail.cols,
                }
            });
        };
        ctx.shell.addEventListener('signal.window-resize', resize_listener);

        // TODO: handle CLOSE -> emu needs to close connection first
        const app_close_promise = new TeePromise();
        const sigint_promise = new TeePromise();

        const decoder = new TextDecoder();
        emu.on('message', message => {
            if (message.$ === 'stdout') {
                ctx.externs.out.write(decoder.decode(message.data));
            }
            if (message.$ === 'chtermios') {
                if ( message.termios.echo !== undefined ) {
                    if ( message.termios.echo ) {
                        ctx.externs.echo.on();
                    } else {
                        ctx.externs.echo.off();
                    }
                }
            }
        });

        // Repeatedly copy data from stdin to the child, while it's running.
        // DRY: Initially copied from PathCommandProvider
        let data, done;
        const next_data = async () => {
            console.log('!~!!!!!');
            ({ value: data, done } = await Promise.race([
                app_close_promise, sigint_promise, ctx.externs.in_.read(),
            ]));
            console.log('next_data', data, done);
            if (data) {
                console.log('sending stdin data');
                emu.postMessage({
                    $: 'stdin',
                    data: data,
                });
                if (!done) setTimeout(next_data, 0);
            }
        };
        setTimeout(next_data, 0);

        emu.postMessage({
            $: 'exec',
            command: this.available[id],
            args: [],
        });

        const never_resolve = new TeePromise();
        await never_resolve;
    }
}
