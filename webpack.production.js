const { merge } = require('webpack-merge')
const commonConfig = require('./webpack.common.js')
const TerserPlugin = require("terser-webpack-plugin");

const devConfig = {
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /(node_modules|bower_components|aiProxy\.bundle\.js)/,
        type: 'javascript/esm',
        use: ['babel-loader']
      },
    ]
  },
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin({
      parallel: true,
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true
        }
      }
    })],
  }
}
module.exports = merge(commonConfig, devConfig)