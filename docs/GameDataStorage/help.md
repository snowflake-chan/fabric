<script setup>
import '/style.css'
</script>

# 📈 游戏数据存储

这是一套可以让你存储数据的 api，无论地图被重启还是崩溃重新运行都好，数据都能被很好的存储。
许多神岛地图都在用这套 api 去做玩家数据存档，记录玩家获得了多少金币，有什么道具，分数是多少等。

- **GameDataStorage** 代表数据存储空间的类，能控制单地图或组地图数据库，能够以键值对的形式存储数据，提供方法处理空间内键值对相关的操作。
- 可以通过全局对象 `storage` 来使用它。

## 类

```typescript
declare const storage: GameStorage;
declare class GameStorage {
  //...
}
```

## 属性

- [`key`](./getSpace#key) : 获取数据存储空间名称

## 方法

以下，是 storage 所有的方法，稍后会讲解以下方法要如何使用

- [`getDataStorage`](./getSpace#getDataStorage) : 【单地图】连接指定数据存储空间，如果不存在则创建一个新的空间。
- [`getGroupStorage`](./getSpace#getGroupStorage) :【主副图】连接指定数据存储空间，如果不存在则创建一个新的空间。
- [`set`](./setSpace#set) : 传入指定键与值，无论该键是否存在，均将值设置到此键上
- [`get`](./setSpace#get) : 获取指定键对应的值
- [`update`](./setSpace#update) : 更新指定键对应的值
- [`remove`](./setSpace#remove) : 删除指定键值对
- [`list`](./setSpace#list) : 批量获取键值对
- [`destroy`](./setSpace#destroy) : 删除该数据空间

## 接口

- [`JSONValue`](./setSpace#JSONValue) : 允许存储的值
- [`ReturnValue`](./setSpace#ReturnValue) : 表示一个键值对的内容。它可以是一个对象或者 `undefined`
- [`ListPageOptions`](./setSpace#ListPageOptions) : 批量获取键值对的配置项
- [`QueryList`](./setSpace#QueryList) : 键值对查询列表，用于批量获取键值对，通过 {GameDataStorage.list} 方法返回

---

在进一步学习前，我们先来了解一下，这个 storage 是以什么形式去保存数据的呢？

是以表格的形式，而且是只有两个栏目（键名称和值内容）还不能添加新栏目的表格。

就像老师给你打印了一个表格让你填但是你不能另外加一个自己想写的栏目进去。

![表格格式](https://pic.imgdb.cn/item/671310a9d29ded1a8cd27ce5.jpg)

# 获取数据空间

> **存储空间隔离**
>
> 当游戏服务器尝试连接指定名称的空间时：
>
> - 不同地图的服务器，连接到的空间不同
> - 同一地图不同服务器，连接到的空间相同
> - 编辑模式与游戏服务器连接的空间不同

## 方法

### 获取地图里的数据存储空间

### <font id="API" />getDataStorage(<font id="Type">key: string</font>)<font id="Type">: [GameDataStorage](./setSpace)</font>{#getDataStorage}

连接指定数据存储空间，如果不存在则创建一个新的空间。

只能在本地图使用此空间，其他地图（如副图）无法访问此空间，从而避免全局污染。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                                                   |
| -------- | -------- | ---------- | -------- | ---------------------------------------------------------- |
| key      | 是       |            | string   | 自定义的空间名称，建议**全英文**命名，长度不超过 50 个字符 |

**返回值**

| **类型**        | **说明**         |
| --------------- | ---------------- |
| GameDataStorage | 数据存储空间对象 |

这个 api，可以给你返回一张表，首先你要告诉他你要的这张表叫什么名字，然后他才能给你对应的表。

值得注意的是，这个 api 返回的表格只能在当前地图访问，不与其他主图副图互通。

比如说，我想要一张叫做 userData(用户信息)的表，那我需要这样写：

```javascript
const userTable = storage.getDataStorage('userData');
```

如果存在已经存在一张叫 userData 的表格，他会直接给你。如果不存在，他会创建一张叫 userData 的空表格给你。

这里我把这张表格放在了一个叫 userTable 的变量里

### 获取全局（主副图互通）的数据存储空间

### <font id="API" />getGroupStorage(<font id="Type">key: string</font>)<font id="Type">: [GameDataStorage](./setSpace)</font>{#getGroupStorage}

连接指定数据存储空间，如果不存在则创建一个新的空间。

此方法为主图和副图共同维护的数据存储空间。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                                                   |
| -------- | -------- | ---------- | -------- | ---------------------------------------------------------- |
| key      | 是       |            | string   | 自定义的空间名称，建议**全英文**命名，长度不超过 50 个字符 |

**返回值**

| **类型**        | **说明**         |
| --------------- | ---------------- |
| GameDataStorage | 数据存储空间对象 |

这个 api 和上一个 api 是一样的，但唯一的区别是，这个 api 给你的表是主副图互通的。

如果你这希望张表格记录着的数据每一个副图包括主图都能访问到的话，记得要用这个 api 去要表格哦。

### 删除一个数据存储空间

### <font id="API" />destroy()<font id="Type">: Promise‹void›</font> {#destroy}

删除该数据空间。

如果你需要删除掉这个表格，可以这样做：

```javascript
userTable.destroy();
```

---

在获取到表格以后，你就可以对这个表格进行操作啦！

# 操作数据

## 属性

### 获取数据存储空间名称

### <font id="API" /><font id="ReadOnly">只读</font>key<font id="Type">: string</font> {#key}

> 默认值：空间名称

获取数据存储空间名称。

在获取到的表格下有一个属性，叫 key，它存储了这个表格的名字，你可以下面这个代码来获取并打印出这个表格的名字

```javascript
const userTable = storage.getDataStorage('users');
const storageName = userTable.key;
console.log(`storageName: ${storageName}`);
```

:::

## 方法

### 将新数据写入表格

### <font id="API" />set(<font id="Type">key: string,value:[JSONValue](./setSpace#JSONValue)</font>)<font id="Type">: Promise‹void›</font> {#set}

传入指定键与值，无论该键是否存在，均将值设置到此键上。

**输入参数**

| **参数** | **必填** | **默认值** | **类型**  | **说明**     |
| -------- | -------- | ---------- | --------- | ------------ |
| key      | 是       |            | string    | 需要设置的键 |
| value    | 是       |            | JSONValue | 需要设置的值 |

这个 api，可以帮你添加一项数据。

首先你要告诉它需要设置的键的名称，然后再告诉它你要设置的值。

比如我要往这张表里写上：吉吉喵有 100 块钱

```javascript
userTable.set('吉吉喵', 100);
```

执行完这行代码后，你的表格就是这样的：
![表格更改预览](https://pic.imgdb.cn/item/6713174fd29ded1a8cdf1829.jpg)

还有一点可以注意一下！
你写入的数据（即需要设置的值）可以是以下类型：

### <font id="API" />JSONValue {#JSONValue}

允许存储的值，类型可以是如下类型之一：

| **参数**                  | **说明**       |
| ------------------------- | -------------- |
| string                    | 字符串         |
| number                    | 数字           |
| boolean                   | 布尔值         |
| JSONValue[]               | JSONValue 数组 |
| `{[x: string]:JSONValue}` | 键值对         |

### 获取键名称对应的数据

### <font id="API" />get(<font id="Type">key: string</font>)<font id="Type">: Promise‹[ReturnValue](./setSpace#ReturnValue)›</font> {#get}

获取指定键对应的值。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明** |
| -------- | -------- | ---------- | -------- | -------- |
| key      | 是       |            | string   | 指定的键 |

**返回值**

| **类型**    | **说明**                                          |
| ----------- | ------------------------------------------------- |
| ReturnValue | 异步返回数据，当获取完成时 resolve，否则 reject。 |

这个 api 可以帮你拿到表格里的数据。

只需要告诉它你想要的数据的键值他就可以告诉你对应的数据啦！

比如我想知道吉吉喵有多少钱，那我就应该这样写：

```javascript
ggm_data = await userTable.get('吉吉喵');
```

那这时候 ggm_data 里放的就是吉吉喵拥有的钱数了吗？是，也不是，因为它还有其他信息在里面：

#### <font id="API" />ReturnValue {#ReturnValue}

表示一个键值对的内容。它可以是一个对象或者 `undefined`

| **参数**   | **类型**  | **说明**         |
| ---------- | --------- | ---------------- |
| key        | string    | 键名称           |
| value      | JSONValue | 值内容           |
| updateTime | number    | key 最近更新时间 |
| createTime | number    | key 创建时间     |
| version    | string    | 更新版本号       |

也就是说，我想知道吉吉喵有多少钱还需要一步：

```javascript
console.log(ggm_data.value); // 打印出：100
```

那么相应的，如果想要获取其他信息，这样就好了：

```javascript
console.log(ggm_data.key); // 打印出："吉吉喵"
console.log(ggm_data.updateTime); // 打印出：1729302316497 这是一个时间戳哦
console.log(ggm_data.createTime); // 打印出：1729302316362 这是一个时间戳哦
console.log(ggm_data.version); // 打印出："01JAH76HEG1MERXN82PWTDBHM0"
```

### 更新表格数据

### <font id="API" />update(<font id="Type">key: string,handler:(prevValue:[ReturnValue](./setSpace#ReturnValue))=>[JSONValue](./setSpace#JSONValue)</font>)<font id="Type">: Promise‹void›</font> {#update}

更新指定键对应的值。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                                                       |
| -------- | -------- | ---------- | -------- | -------------------------------------------------------------- |
| key      | 是       |            | string   | 指定的键                                                       |
| handler  | 是       |            | function | 处理更新的方法，接受一个参数，为当前键的值，返回一个更新后的值 |

这个 api 用于更新已经存在的键值的内容
比如说现在 userTbale 这个表里现在只有吉吉喵的数据，没有搬砖喵的数据，那就不能使用这个 api 进行搬砖喵数据的编辑，只能使用 set 方法往表里写入搬砖喵的数据。

这个 api 需要你给它两个东西，一个是键值名称，另一个是一个...函数！？
嗯对的，是一个函数，你需要在这个函数里面把你要更新的数据 return 给它。

现在，吉吉喵从美术喵这买了三个小鱼干花费 12 元还剩下 88 元，那么可以这么写去更新数据：

```javascript
await userTable.update('吉吉喵', () => {
  // 更新玩家数据存档
  return 88;
});
```

### 删除表格数据

### <font id="API" />remove(<font id="Type">key: string</font>)<font id="Type">: Promise‹[ReturnValue](./setSpace#ReturnValue)›</font> {#remove}

删除指定键值对。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明** |
| -------- | -------- | ---------- | -------- | -------- |
| key      | 是       |            | string   | 指定的键 |

**返回值**

| **类型**    | **说明**                                          |
| ----------- | ------------------------------------------------- |
| ReturnValue | 异步返回数据，当删除完成时 resolve，否则 reject。 |

这个 api 用于删除表里的内容。

只需要给它一个键值就能删除相应的数据。

比如说，吉吉喵和和平队长吵架了，吉吉喵一气之下注销了账号。
那么这时可以这样删除吉吉喵的数据：

```javascript
await userTable.remove('吉吉喵');
```

### 把表格整理成一本书？

#### <font id="API" />list(<font id="Type">options:Partial‹[ListPageOptions](./setSpace#ListPageOptions)›</font>)<font id="Type">: Promise‹[QueryList](./setSpace#QueryList)›</font> {#list}

批量获取键值对。

**输入参数**

| **参数** | **必填** | **默认值** | **类型**                 | **说明**               |
| -------- | -------- | ---------- | ------------------------ | ---------------------- |
| options  | 是       |            | Partial‹ListPageOptions› | 批量获取键值对的配置项 |

**返回值**

| **类型**  | **说明**                                          |
| --------- | ------------------------------------------------- |
| QueryList | 异步返回数据，当获取完成时 resolve，否则 reject。 |

这个 api 可以帮你把表格的数据整理成一本“书”

默认每一页放 100 条数据，当然这个是可以调整的。

那这本书的整理方式还有什么自定义的？请看 api：

#### <font id="API" />ListPageOptions {#ListPageOptions}

批量获取键值对的配置项。

| **参数**         | **类型** | **说明**                                                                                                                                                                                                                                                                                                  |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cursor           | number   | **必选**分页指针，用于指定本次获取的分页起点页码。                                                                                                                                                                                                                                                        |
| pageSize         | number   | 可选项，分页大小，一页内的数据量，取值范围[0,100]，默认 100。                                                                                                                                                                                                                                             |
| constraintTarget | string   | - 约束目标值的路径，当值是 JSON 格式时，指定用作排序的值的路径。例如传入 `score`时，会取值上`score`属性的值作为排序、最大最小值的限制目标；<br/>- 可以级联最多 5 级，例如`a.b.c.d.e`，超出视作非法参数，按下一条方式处理；<br/>- 当路径不存在或传入非法参数时，以值本身作为目标进行排序，并打印一条警告； |
| ascending        | boolean  | 是否升序，设置为 true 时为升序，false 为降序，不传或传入 undefined 时不排序；                                                                                                                                                                                                                             |
| max              | number   | 最大值，过滤返回对应值的最大值，超出或非数字则不返回该 Key，默认不过滤；                                                                                                                                                                                                                                  |
| min              | number   | 最小值，同 max 类似。                                                                                                                                                                                                                                                                                     |

那我们要如何获得这本“书”呢？
这样就可以啦：

```javascript
const queryList = await userTable.list({
    // 分页指针，用于指定本次获取的分页起点。
    cursor: 0,
    // 分页大小，一页内的数据量，默认100。
    pageSize: 100,
    // 数据升序
    ascending: true;
    // 过滤掉钱数多余100的富豪（bushi
    max: 100,
    // 过滤掉负债的穷鬼（什
    min: 0,
})
```

其中 cursor 是必须传入的，从最开头获取数据时填 0 就好

### 那如何翻这本书？

#### <font id="API" />QueryList {#QueryList}

键值对查询列表，用于批量获取键值对，通过 {GameDataStorage.list} 方法返回。

列表根据配置项被划分为一个或多个分页，每个分页最多包含 { [QueryList](./setSpace#QueryList) | pageSize} 个键值对。

| **参数**         | **类型**                                    | **说明**                                                                  |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| isLastPage       | boolean                                     | 是否为最后一页，如果翻过头了，也会为 true                                 |
| getCurrentPage() | ()=>[ReturnValue](./setSpace#ReturnValue)[] | 按 {QueryList &#124; pageSize} 获取当前页的键值对，返回当前页的键值对内容 |
| nextPage()       | ()=> Promise‹void›                          | 翻到下一页，执行后 {getCurrentPage} 将返回下一页的键值对内容              |

我们使用这本“书”的`getCurrentPage()`方法就可以获取到这一页的全部内容，他是个列表哦。

那如果我们想把当前这页的内容全部打印出来，我们可以利用 for 循环这样写：

```javascript
for (let value of queryList.getCurrentPage()) {
  console.log(`${value.key} 有：${value.value}元`);
}
```

然后`nextPage()`是翻页，翻到下一页，然后就可以又通过`getCurrentPage()`方法读取这一页的数据。

`isLastPage()`方法返回一个布尔值（`true` or `false`），如果为 true 则这一页是这本“书”的最后一页啦！

比如我们要把这本“书”的内容，一页打印完再翻到下一页知道全部内容都打印出来，我们可以这样写：

```javascript
while (true) {
  for (let value of queryList.getCurrentPage()) {
    console.log(`${value.key} 有：${value.value}元`);
  }
  // 假如为最后一页，退出循环
  if (queryList.isLastPage) break;
  // 翻到下一页
  await queryList.nextPage();
}
```

#### 完整示例：

```javascript
const queryList = await userTable.list({
  // 分页指针，用于指定本次获取的分页起点。
  cursor: 0,
  // 分页大小，一页内的数据量，默认100。
  pageSize: 100,
});
while (true) {
  for (let value of queryList.getCurrentPage()) {
    console.log(`${value.key} 有：${value.value}元`);
  }
  // 假如为最后一页，退出循环
  if (queryList.isLastPage) break;
  // 翻到下一页
  await queryList.nextPage();
}
```

## 节约服务器资源，从我做起！

在进行数据库读取的时候请大家不要进行过高频的的读写哦。

神岛对于防止地图读取数据库过度频繁，也有一些限制，详细解释请看：

### 服务器维度

对每一个游戏服务器独立生效，与服务器在线玩家数正相关，同一队列中的所有 API 共享限制。

| 队列 | API                       | 限制                                |
| ---- | ------------------------- | ----------------------------------- |
| 写入 | set<br/>update<br/>remove | （60 + 玩家数 \* 10 ）次操作 / 分钟 |
| 读取 | get<br/>update            | （120 + 玩家数\*20）次操作/分钟     |

注；当前版本下，此处玩家数取固定值 70。

这里的意思是，

每分钟写入次数不得超过（60 + 玩家数 \* 10 ）次，

每分钟读取次数不得超过（120 + 玩家数\*20）次

但是当前版本下，无论地图有多少人，纳入次数限制计算的玩家数量都为 70

### 吞吐量维度

对每一个 Key 的任意操作有吞吐量的限制。

| 队列 | API                       | 限制    |
| ---- | ------------------------- | ------- |
| 写入 | set<br/>update<br/>remove | 4M/min  |
| 读取 | get<br/>update            | 25M/min |

也就是说，整张表格每分钟读取的流量不得超过 4M，读取流量不得超过 25M

## 错误码

在进行数据库操作的时候遇到报错了？报错信息对应意思如下：

| Code | Status             | Error Message              | 描述                               |
| ---- | ------------------ | -------------------------- | ---------------------------------- |
| 400  | DB_NAME_INVALID    | Invalid data storage name. | 存储空间名为空，或不满足限制要求。 |
| 400  | KEY_INVALID        | Invalid data key.          | 数据键为空。                       |
| 400  | VALUE_INVALID      | Invalid data value.        | 数据值为空。                       |
| 400  | PARAMS_INVALID     | Invalid parameters.        | 参数不合法。                       |
| 429  | REQUEST_THROTTLED  | Too Many Requests          | 超出操作频率限制                   |
| 500  | SERVER_FETCH_ERROR | Server network error.      | 服务由于网络原因请求失败。         |
| 500  | UNKNOWN            | Unknown server error.      | 未知的服务器错误。                 |

# 在写玩家数据存档时的一些建议

1. 键值用玩家 userKey，因为 userKey 是不可以被更改的，而用户名和 boxid 都能在设置页改。如果使用用户名或 boxid 作为键值存储玩家数据的话，万一玩家更改了自己的用户名或者 boxid，在地图里属于这位玩家的数据就不能对应上了
2. 一般需要存储的数据有很多个，比如金钱、道具数量、分数、等级等等，虽然也可以创建好几一个表格，一个记录分数一个记录等级...但是还是建议大家使用对象存储玩家数据然后把对象放到表格里面，也就会这种形式的：

```javascript
entity.player.data = {
  red_c: 0,
  blue_c: 0,
  win_count: 0, // 获胜局数统计
  game_count: 0, // 玩家进行游戏的局数统计
  bag: [], // 玩家背包
  credit: 100, // 玩家信用分，用于约束中途离开游戏的行为
};
```

### 最后给大家附上一个玩家数据存档的示例代码：

```javascript
console.clear();
const dataTable = storage.getGroupStorage('userData'); // 获取表格
// 玩家进入地图时，获取玩家信息或初始化玩家信息
world.onPlayerJoin(async ({ entity }) => {
  var userData = await dataTable.get(entity.player.userKey); // 尝试通过玩家userKey获取其数据
  try {
    // 读取成功，将数据设置到玩家身上
    entity.player.data = userData.value;
  } catch {
    // 读取失败，初始化玩家数据
    entity.player.data = {
      red_c: 0,
      blue_c: 0,
      win_count: 0, // 获胜局数统计
      game_count: 0, // 玩家进行游戏的局数统计
      bag: [], // 玩家背包
      credit: 100, // 玩家信用分，用于约束中途离开游戏的行为
    };
    // dataTable.set(entity.player.userKey,JSON.stringify(entity.player.data))
    dataTable.set(entity.player.userKey, entity.player.data); // 写入表格
  }
  console.log(JSON.stringify(entity.player.data));
});

// 玩家离开地图时，保存玩家数据
world.onPlayerLeave(async ({ entity }) => {
  entity.player.data['game_count'] = 3; // 模拟游戏中玩家数据发生改变
  await dataTable.update(entity.player.userKey, () => {
    // 更新玩家数据存档
    return entity.player.data;
  });
});
```
