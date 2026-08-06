const webpack = require('webpack')
const { merge } = require('webpack-merge')
const commonConfig = require('./webpack.common.js')
const devConfig = {
  mode: 'development',
  module: {
  rules: [
    {
      test: /\.js$/,
      exclude: /(node_modules|bower_components)/,
      type: 'javascript/esm',
      use: ['babel-loader']
    },
  ]
},
  // Chrome 扩展(MV3) 的 CSP 禁止 unsafe-eval，需避免基于 eval 的 source map
  // 例如 'eval'、'cheap-module-eval-source-map'、'eval-source-map' 等
  // 使用非 eval 的选项，如 'cheap-module-source-map' 或直接关闭 sourcemap
  devtool: 'cheap-module-source-map',
  optimization: {
    minimize: false
  },
  // 在某些 Windows/网络盘/WSL 环境下，原生文件监听不稳定，改用轮询
  // 根据项目规模可适当调大/调小 poll 与 aggregateTimeout
  watchOptions: {
    ignored: /node_modules/,
    poll: 1000,
    aggregateTimeout: 300,
  },
}
module.exports = merge(commonConfig, devConfig)