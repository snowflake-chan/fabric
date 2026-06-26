<script setup>
import '/style.css'
</script>

# 获取数据空间

在新神岛中，数据存储功能采用了基于键值对的 NoSQL 数据库，即 `Key-Value` 存储系统。该系统类似于 Redis，具备以下特点：

- **存储形式**：以键值对的形式存储数据，简单高效。
- **适用场景**：适合存储简单的数据结构，如缓存数据。

#### 键（Key）

- **定义**：用于唯一标识数据的字符串。
- **功能**：确保每个数据项都能被唯一地访问和检索。

#### 值（Value）

- **定义**：与键关联的数据，可以是任何类型的信息。
- **类型**：包括但不限于字符串、对象等。
- **功能**：存储与键相关的具体数据内容。

#### 存储（Store）

- **定义**：用于存储和检索键值对的系统或服务。
- **功能**：提供数据的存储、检索和管理功能，确保数据的可靠性和安全性。

## 方法

#### <font id="API" />getDataStorage(<font id="Type">key: string</font>)<font id="Type">: [GameDataStorage](./setSpace)</font>{#getDataStorage}

连接指定数据存储空间，如果不存在则创建一个新的空间。

只能在本地图使用此空间，其他地图（如副图）无法访问此空间，从而避免全局污染。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                                                 |
| -------- | -------- | ---------- | -------- | -------------------------------------------------------- |
| key      | 是       |            | string   | 自定义的空间名称，建议**全英文**命名，长度不超过50个字符 |

**返回值**

| **类型**        | **说明**         |
| --------------- | ---------------- |
| GameDataStorage | 数据存储空间对象 |

---

#### <font id="API" />getGroupStorage(<font id="Type">key: string</font>)<font id="Type">: [GameDataStorage](./setSpace)</font>{#getGroupStorage}

连接指定数据存储空间，如果不存在则创建一个新的空间。

此方法为主图和副图共同维护的数据存储空间。

**输入参数**

| **参数** | **必填** | **默认值** | **类型** | **说明**                                                 |
| -------- | -------- | ---------- | -------- | -------------------------------------------------------- |
| key      | 是       |            | string   | 自定义的空间名称，建议**全英文**命名，长度不超过50个字符 |

**返回值**

| **类型**        | **说明**         |
| --------------- | ---------------- |
| GameDataStorage | 数据存储空间对象 |

## 存储空间隔离

当游戏服务器尝试连接指定名称的空间时：

- 不同地图的服务器，连接到的空间不同
- 同一地图不同服务器，连接到的空间相同
- 编辑模式与游戏服务器连接的空间不同

## 服务器维度

对每一个游戏服务器独立生效，与服务器在线玩家数正相关，同一队列中的所有API共享限制。

| 队列 | API                       | 限制                                |
| ---- | ------------------------- | ----------------------------------- |
| 写入 | set<br/>update<br/>remove | （60 + 玩家数 \* 10 ）次操作 / 分钟 |
| 读取 | get<br/>update            | （120 + 玩家数\*20）次操作/分钟     |

注；当前版本下，此处玩家数取固定值70。

## 吞吐量维度

对每一个 Key 的任意操作有吞吐量的限制。

| 队列 | API                       | 限制    |
| ---- | ------------------------- | ------- |
| 写入 | set<br/>update<br/>remove | 4M/min  |
| 读取 | get<br/>update            | 25M/min |

## 错误码

| Code | Status             | Error Message              | 描述                               |
| ---- | ------------------ | -------------------------- | ---------------------------------- |
| 400  | DB_NAME_INVALID    | Invalid data storage name. | 存储空间名为空，或不满足限制要求。 |
| 400  | KEY_INVALID        | Invalid data key.          | 数据键为空。                       |
| 400  | VALUE_INVALID      | Invalid data value.        | 数据值为空。                       |
| 400  | PARAMS_INVALID     | Invalid parameters.        | 参数不合法。                       |
| 429  | REQUEST_THROTTLED  | Too Many Requests          | 超出操作频率限制                   |
| 500  | SERVER_FETCH_ERROR | Server network error.      | 服务由于网络原因请求失败。         |
| 500  | UNKNOWN            | Unknown server error.      | 未知的服务器错误。                 |

## 示例代码

```javascript
console.clear();

const testStorage = storage.getDataStorage('test');

async function storageExample() {
  await testStorage.set('keyNumber', 1);
  await testStorage.set('keyStr', '字符串');
  await testStorage.set('keyBoolean', false);
  await testStorage.set('keyJson', { describe: 'json内容' });

  let numberValue = await testStorage.get('keyNumber');
  let strValue = await testStorage.get('keyStr');
  let boolValue = await testStorage.get('keyBoolean');
  let jsonValue = await testStorage.get('keyJson');

  console.log(`keyNumber 的 value： ${numberValue.value}`);
  console.log(`keyStr 的 value： ${strValue.value}`);
  console.log(`keyBoolean 的 value： ${boolValue.value}`);
  console.log(`keyJson 的 value： ${JSON.stringify(jsonValue.value)}`);
  await sleep(1000);

  numberValue = await testStorage.remove('keyNumber');
  strValue = await testStorage.remove('keyStr');
  boolValue = await testStorage.remove('keyBoolean');
  jsonValue = await testStorage.remove('keyJson');

  console.log('\n==========================\n\n');
  console.log(`keyNumber 的 value： ${numberValue}`);
  console.log(`keyStr 的 value： ${strValue}`);
  console.log(`keyBoolean 的 value： ${boolValue}`);
  console.log(`keyJson 的 value： ${JSON.stringify(jsonValue)}`);
  await sleep(1000);

  await testStorage.update('keyNumber', (preData) => {
    return 2;
  });
  await testStorage.update('keyStr', (preData) => {
    return '被更改的字符串';
  });
  await testStorage.update('keyBoolean', (preData) => {
    return true;
  });
  await testStorage.update('keyJson', (preData) => {
    return { describe: 'json内容被更改' };
  });

  numberValue = await testStorage.get('keyNumber');
  strValue = await testStorage.get('keyStr');
  boolValue = await testStorage.get('keyBoolean');
  jsonValue = await testStorage.get('keyJson');

  console.log('\n==========================\n\n');
  console.log(`keyNumber 的 value： ${numberValue.value}`);
  console.log(`keyStr 的 value： ${strValue.value}`);
  console.log(`keyBoolean 的 value： ${boolValue.value}`);
  console.log(`keyJson 的 value： ${JSON.stringify(jsonValue.value)}`);
  await sleep(1000);

  console.log('\n==========================\n\n');

  const queryList = await testStorage.list({
    // 分页指针，用于指定本次获取的分页起点。
    cursor: 0,
    // 分页大小，一页内的数据量，默认100。
    pageSize: 100,
  });
  while (true) {
    for (let value of queryList.getCurrentPage()) {
      console.log(`${value.key} 的 value：${JSON.stringify(value.value)}`);
    }
    // 假如为最后一页，退出循环
    if (queryList.isLastPage) break;
    // 翻到下一页
    await queryList.nextPage();
  }
}

storageExample();
```
