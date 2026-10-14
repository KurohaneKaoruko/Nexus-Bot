# Spec Delta

## Purpose

以 rolldown 打包 TypeScript 源码，按分支变体选择 main 入口并上传到目标服务器的对应游戏分支，实现不同服务器运行不同入口代码；凭据仅存本地。

## ADDED Requirements

### Requirement: 分支变体入口选择
构建必须依据变体标识选择入口：缺省变体使用 `src/main.ts`，命名变体使用 `src/branch/<variant>/main.ts`。变体缺少对应入口时构建必须以明确错误信息失败。

#### Scenario: 缺省构建
- **WHEN** 未指定变体执行构建
- **THEN** 使用 src/main.ts 打包产出 dist/main.js

#### Scenario: 命名变体构建
- **WHEN** 以变体 local 执行构建
- **THEN** 使用 src/branch/local/main.ts 作为入口打包

#### Scenario: 未知变体报错
- **WHEN** 指定的变体没有对应入口文件
- **THEN** 构建失败并列出可用变体，不产出、不上传

### Requirement: 类型检查门禁
类型检查必须是构建的前置步骤：类型检查失败时构建失败且不执行上传。

#### Scenario: 类型错误阻止上传
- **WHEN** 源码存在类型错误时执行提交
- **THEN** 构建失败并报告错误位置，不进行任何上传

### Requirement: 按目标环境上传
提交必须支持把构建产物上传到指定服务器[@账号]的对应游戏分支，分支不存在时先创建再上传；本地目录型目标改为把产物复制到本地客户端目录。

#### Scenario: 上传私服分支
- **WHEN** 选择某 API 型服务器与分支执行提交
- **THEN** 构建产物上传至该服务器对应分支

#### Scenario: 本地客户端部署
- **WHEN** 选择本地目录型服务器执行提交
- **THEN** 产物（main.js 与 sourcemap 模块）被复制到本地客户端目录

### Requirement: sourcemap 随包上传
构建在启用 sourcemap 时必须剥离 sourcesContent、把映射整理为可上传的映射模块随代码一并上传，使线上错误堆栈可映射回源码位置。

#### Scenario: 线上堆栈还原
- **WHEN** 线上发生带堆栈的错误且映射模块已上传
- **THEN** 运行时可将堆栈解析到源码文件与行号

### Requirement: 凭据不入库
服务器凭据必须只来自本地 `.secret.json`（已被 git 排除）或进程环境；源码与构建产物中不得包含任何凭据内容。

#### Scenario: 产物无凭据
- **WHEN** 构建完成
- **THEN** 产物内容不包含 `.secret.json` 中的凭据信息
