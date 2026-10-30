import {it,expect} from 'vitest';
import {Store} from '../server/db.js';
import {nearestFrame} from '../server/adapters/obs/frames.js';
it('matches nearest frame only within twenty seconds of evidence',()=>{const db=new Store(':memory:',0);db.run('INSERT INTO frames(captured_at_ms,path) VALUES(?,?)',10000,'data/frames/a.jpg');db.run('INSERT INTO frames(captured_at_ms,path) VALUES(?,?)',20000,'data/frames/b.jpg');expect(nearestFrame(db,18000)?.url).toBe('/frames/b.jpg');expect(nearestFrame(db,41000)).toBeNull();db.close()});
