import type {ObsAdapter} from './types.js';
export class SimObs implements ObsAdapter {status='simulator';constructor(private log:(kind:string,text:string)=>void){}async enterCourt(scene:string){this.log('obs',`SIM switch scene: ${scene||'current scene'}`)}async restore(){this.log('obs','SIM restore previous scene')}}
