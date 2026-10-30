import {it,expect} from 'vitest';
import {RealTwitch,protectedUser} from '../server/adapters/twitch/real.js';
import {defaults} from '../server/config.js';
import {Store} from '../server/db.js';
import {Sentencer} from '../server/court/sentencing.js';
import {SimTwitch} from '../server/adapters/twitch/sim.js';
it('never permits protected accounts for contempt',()=>{expect(protectedUser({id:'b',login:'b'},'b')).toBe(true);for(const badge of ['broadcaster','mod','vip'])expect(protectedUser({id:'u',login:'u',[badge]:true},'b')).toBe(true);expect(protectedUser({id:'u',login:'u'},'b')).toBe(false)});
it('real adapter DRY_RUN logs title mutation without credentials or Helix calls',async()=>{const logs:string[]=[];const adapter=new RealTwitch((_k,m)=>logs.push(m),()=>defaults);await adapter.setTitle('[CONVICTED] Dry run');expect(logs).toContain('DRY_RUN setTitle: [CONVICTED] Dry run');adapter.close()});
it('restores overdue persisted title jobs exactly once after boot',async()=>{const db=new Store(':memory:',0),logs:string[]=[];const twitch=new SimTwitch((_k,m)=>logs.push(m));db.run('INSERT INTO sentences_applied VALUES(?,?,?,?,0)',1,'title_shame',JSON.stringify({originalTitle:'The original title',dryRun:true}),1000);const executor=new Sentencer(db,twitch,()=>{});await executor.reverts(1001);await executor.reverts(2000);expect(logs.filter(s=>s.includes('setTitle'))).toEqual(['SIM setTitle: The original title']);expect(db.get<{reverted:number}>('SELECT reverted FROM sentences_applied')?.reverted).toBe(1);db.close()});
