import {createRoot} from 'react-dom/client';
import {Overlay} from './overlay/Overlay';
import {Panel} from './panel/Panel';
createRoot(document.getElementById('root')!).render(location.pathname==='/overlay'?<Overlay/>:<Panel/>);
