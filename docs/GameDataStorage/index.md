# S-📈 游戏数据存储

**GameDataStorage** 是游戏中的数据存储系统，它提供了以下核心功能：

- 数据管理：以键值对形式存储和管理游戏数据
- 空间控制：支持单地图和组地图的数据存储空间管理
- 原子操作：提供安全的数据读写和更新机制

你可以通过全局对象 `storage` 来使用这些功能。

## 类定义

```typescript
declare const storage: GameStorage;
declare class GameStorage {
  //...
}
```

## 属性列表

### 基础信息

- [`key`](./getSpace#key) : 获取数据存储空间名称

## 方法列表

### 空间管理

- [`getDataStorage`](./getSpace#getDataStorage) : 【单地图】连接指定数据存储空间，如果不存在则创建一个新的空间
- [`getGroupStorage`](./getSpace#getGroupStorage) :【主副图】连接指定数据存储空间，如果不存在则创建一个新的空间
- [`destroy`](./setSpace#destroy) : 删除该数据空间

### 数据操作

- [`set`](./setSpace#set) : 传入指定键与值，无论该键是否存在，均将值设置到此键上
- [`get`](./setSpace#get) : 获取指定键对应的值
- [`update`](./setSpace#update) : 更新指定键对应的值
- [`remove`](./setSpace#remove) : 删除指定键值对
- [`increment`](./setSpace#increment) : 原子方式递增给定键的值，当对应键不存在时视作设置值，对应值不为数字时报错
- [`list`](./setSpace#list) : 批量获取键值对

## 接口定义

### 数据类型

- [`JSONValue`](./setSpace#JSONValue) : 允许存储的值类型
- [`ReturnValue`](./setSpace#ReturnValue) : 表示一个键值对的内容，可以是一个对象或者 `undefined`

### 查询配置

- [`ListPageOptions`](./setSpace#ListPageOptions) : 批量获取键值对的配置项
- [`QueryList`](./setSpace#QueryList) : 键值对查询列表，用于批量获取键值对，通过 {GameDataStorage.list} 方法返回
