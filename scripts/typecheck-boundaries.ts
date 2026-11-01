import {createDomain} from '@between/api';
import {createHttpAdapter} from '@between/api/http';
import {createTelegramTransport} from '@between/bot';
import type {CreateProductDomain,CreateHttpAdapter,CreateTelegramTransport} from '@between/contracts/product';
const domain:CreateProductDomain=createDomain;
const http:CreateHttpAdapter=createHttpAdapter;
const telegram:CreateTelegramTransport=createTelegramTransport;
void domain;void http;void telegram;
