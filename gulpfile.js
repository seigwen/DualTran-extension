/**
 * gulpfile.js文件中定义我们的任务
 * 要运行gulp任务，只需切换到存放gulpfile.js文件的目录(windows平台请使用cmd或者Power Shell等工具)，然后在命令行中执行gulp命令就行了，
 * gulp后面可以加上要执行的任务名，例如gulp task1，如果没有指定任务名，则会执行任务名为default的默认任务。
 */

const fs = require("fs");

const gulp = require("gulp");
const zip = require("gulp-zip");
const babel = require("gulp-babel");
const sourcemaps = require("gulp-sourcemaps");

const babelConfig = {
  presets: [
    [
      "@babel/preset-env",
      {
        targets: {
          edge: "17",
          ie: "8",
          firefox: "60",
          chrome: "67",
          safari: "11.1",
        },
        // corejs: 3,
        // useBuiltIns: "usage",
      },
    ],
  ],
  plugins: [
    // ["@babel/plugin-transform-runtime"],
    // ["@babel/plugin-syntax-dynamic-import"],
  ],
};

// 清除dist目录
gulp.task("clean", (cb) => {
  fs.rmSync("dist", { recursive: true, force: true });
  cb();
});

// 复制src目录到dist/firefox目录
gulp.task("firefox-copy", () => {
  return gulp.src(["src/**/**"]).pipe(gulp.dest("dist/firefox"));
});

// 用babel转换部分文件
gulp.task("firefox-babel", () => {
  return Promise.all([
    // 转换dist/firefox/background/*.js文件
    new Promise((resolve, reject) => {
      gulp
        .src(["dist/firefox/background/*.js"])
        .pipe(sourcemaps.init())
        .pipe(babel(babelConfig))
        .pipe(sourcemaps.write())
        .on("error", reject)
        .pipe(gulp.dest("dist/firefox/background"))
        .on("end", resolve);
    }),
    // 转换dist/firefox/lib/*.js文件
    new Promise((resolve, reject) => {
      gulp
        .src(["dist/firefox/lib/*.js"])
        .pipe(sourcemaps.init())
        .pipe(babel(babelConfig))
        .pipe(sourcemaps.write())
        .on("error", reject)
        .pipe(gulp.dest("dist/firefox/lib"))
        .on("end", resolve);
    }),
  ]);
});

// 打包为zip文件
gulp.task("firefox-zip", () => {
  return gulp
    .src(["dist/firefox/**/*"])
    .pipe(zip("firefox.zip"))
    .pipe(gulp.dest("dist"));
});

// 复制src目录到dist/chrome
gulp.task("chrome-copy", () => {
  return gulp.src(["src/**/**"]).pipe(gulp.dest("dist/chrome"));
});

gulp.task("chrome-rename", (cb) => {
  // fs.renameSync(
  //   "dist/chrome/manifest.json",
  //   "dist/chrome/firefox_manifest.json"
  // );
  // fs.renameSync(
  //   "dist/chrome/chrome_manifest.json",
  //   "dist/chrome/manifest.json"
  // );
  cb();
});

// 用babel转换部分文件
gulp.task("chrome-babel", () => {
  return Promise.all([
    // 转换dist/chrome/background/*.js文件
    new Promise((resolve, reject) => {
      gulp
        .src(["dist/chrome/background/*.js"])
        .pipe(sourcemaps.init())
        .pipe(babel(babelConfig))
        .pipe(sourcemaps.write())
        .on("error", reject)
        .pipe(gulp.dest("dist/chrome/background"))
        .on("end", resolve);
    }),
    // 转换dist/chrome/lib/*.js文件
    new Promise((resolve, reject) => {
      gulp
        .src(["dist/chrome/lib/*.js"])
        .pipe(sourcemaps.init())
        .pipe(babel(babelConfig))
        .pipe(sourcemaps.write())
        .on("error", reject)
        .pipe(gulp.dest("dist/chrome/lib"))
        .on("end", resolve);
    }),
  ]);
});

// 打包为zip文件
gulp.task("chrome-zip", () => {
  return gulp
    .src(["dist/chrome/**/**"])
    .pipe(zip("chrome.zip"))
    .pipe(gulp.dest("dist"));
});

// firefox复制/转换/打包一条龙
gulp.task(
  "firefox-build",
  gulp.series("firefox-copy", "firefox-babel", "firefox-zip")
);

// chrome复制/转换/打包一条龙
gulp.task(
  "chrome-build",
  gulp.series("chrome-copy", "chrome-rename", "chrome-babel", "chrome-zip")
);

// firefox+chrome 复制/转换/打包一条龙
// gulp.task("default", gulp.series("clean", "firefox-build", "chrome-build"));
gulp.task("default", gulp.series("clean", "chrome-build"));
