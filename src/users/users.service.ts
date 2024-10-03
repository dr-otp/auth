import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { PrismaClient, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { ListResponse, PaginationDto } from 'src/common';
import { ObjectManipulator } from 'src/helpers';
import { hasRoles } from 'src/helpers/validate-roles.helper';
import { CreateUserDto, UpdateUserDto } from './dto';

@Injectable()
export class UsersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to the database \\(^.^)/');
  }

  async create(createUserDto: CreateUserDto) {
    return this.user.create({ data: { ...createUserDto, password: bcrypt.hashSync(createUserDto.password, 10) } });
  }

  async findAll(paginationDto: PaginationDto, user: User): Promise<ListResponse<User>> {
    const { page, limit } = paginationDto;
    const isAdmin = hasRoles(user.roles, [Role.Admin]);

    const where = isAdmin ? {} : { deletedAt: null };
    const total = await this.user.count({ where });
    const lastPage = Math.ceil(total / limit);

    const data = await this.user.findMany({
      take: limit,
      skip: (page - 1) * limit,
      where,
      include: {
        creator: { select: { id: true, username: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      meta: { total, page, lastPage },
      data: data.map((user) => ObjectManipulator.exclude(user, ['password', 'createdBy'])),
    };
  }

  async findOne(id: string) {
    const user = await this.user.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, username: true, email: true },
        },
      },
    });

    if (!user)
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `User with id ${id} not found`,
      });

    return ObjectManipulator.exclude(user, ['password', 'createdBy']);
  }

  async findByEmailOrUsername(data: { email?: string; username?: string }) {
    const { email, username } = data;

    const user = await this.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
      include: {
        creator: {
          select: { id: true, username: true, email: true },
        },
      },
    });

    if (!user) {
      const filter = email ? 'email' : 'username';
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `User with ${filter} ${email || username} not found`,
      });
    }

    return ObjectManipulator.exclude(user, ['password', 'createdBy']);
  }

  async findOneWithMeta(id: string) {
    const user = await this.user.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, username: true, email: true },
        },
        creatorOf: {
          select: { id: true, username: true, email: true, createdAt: true, updatedAt: true },
        },
      },
    });

    if (!user)
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `User with id ${id} not found`,
      });

    return ObjectManipulator.exclude(user, ['password', 'createdBy']);
  }

  async findOneWithSummary(id: string) {
    const user = await this.user.findUnique({
      where: { id },
      select: { id: true, username: true, email: true },
    });

    if (!user)
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `User with id ${id} not found`,
      });

    return user;
  }

  async findSummary(ids: string[]) {
    const users = await this.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, email: true },
    });

    return users;
  }

  async update(updateUserDto: UpdateUserDto) {
    const { id, ...data } = updateUserDto;

    await this.findOne(id);

    return this.user.update({ where: { id }, data });
  }

  async remove(id: string) {
    const user = await this.findOne(id);

    if (user.deletedAt)
      throw new RpcException({
        status: HttpStatus.CONFLICT,
        message: `User with id ${id} is already disabled`,
      });

    return this.user.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async restore(id: string) {
    const user = await this.findOne(id);

    if (user.deletedAt === null)
      throw new RpcException({
        status: HttpStatus.CONFLICT,
        message: `User with id ${id} is already enabled`,
      });

    return this.user.update({ where: { id }, data: { deletedAt: null } });
  }
}
