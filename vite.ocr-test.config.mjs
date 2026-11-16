// 仅用于自测：真实配置 + 代理指向隔离后端(3002)与独立端口(5199)
import base from './vite.config.js'

export default {
  ...base,
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3002',
      '/uploads': 'http://127.0.0.1:3002'
    }
  }
}
