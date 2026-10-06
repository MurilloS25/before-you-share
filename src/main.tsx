import { render } from 'preact';
import { App } from './ui/App';
import { AnalysisClient, createBrowserWorker } from './worker/client';
import './ui/styles.css';

const client = new AnalysisClient(createBrowserWorker);
render(<App client={client} />, document.getElementById('root')!);
