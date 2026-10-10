import { render } from 'preact';
import './styles.css';
import { App } from './App';
import { bootstrapToken } from './api';

const root = document.getElementById('app');

if (root) {
  void bootstrapToken().then(() => {
    render(<App />, root);
  });
}